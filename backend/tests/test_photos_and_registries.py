"""Document extraction, photo matching, processor registry, factor registry, platform-based reliability."""
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import DATA_DIR
from app.data.sample_images import make
from app.engines import impact, vision
from app.engines.extraction import parse_text
from app.engines.supply import reliability
from app.main import app

DEMO = json.loads((DATA_DIR / "demo_users.json").read_text())
EMAIL = {u["industry"]: u["email"] for u in DEMO["users"] if u.get("industry")}
FAC = next(u["email"] for u in DEMO["users"] if u.get("role") == "facilitator")


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as client:
        yield client


def login(c, email):
    return {"Authorization": f"Bearer {c.post('/api/auth/login', json={'email': email, 'password': DEMO['password']}).json()['token']}"}


def jpeg(style="phosphogypsum", seed=5, exif=False) -> bytes:
    buf = io.BytesIO()
    img = make(style, seed)
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "SecretCam"  # Make
        img.save(buf, "JPEG", exif=ex)
    else:
        img.save(buf, "JPEG")
    return buf.getvalue()


# ---------------------------------------------------------------- extraction
def test_extraction_values_units_and_metadata():
    r = parse_text("Report date: 12/03/2026\nIssued by: Deccan Test House\nBatch No: PG-2211\nCaO : 31.4 %\n"
                   "Purity (CaSO4.2H2O) 91.5 %\nGCV 3800 kcal/kg\nSiO2 | 2.1 %\nTest method: IS 1288")
    assert r["values"]["CaO"] == 31.4 and r["values"]["purity_pct"] == 91.5 and r["values"]["SiO2"] == 2.1
    assert r["values"]["calorific_value_MJkg"] == pytest.approx(15.9, abs=0.01)  # kcal/kg converted before any comparison
    assert r["issue_date"] == "2026-03-12" and r["issuer"] == "Deccan Test House" and r["batch_code"] == "PG-2211"


def test_extraction_ignores_non_percentages():
    assert "CaO" not in parse_text("CaO 3150 mg/kg")["values"]


def test_extract_endpoint(c):
    h = login(c, EMAIL["Deccan Phosphates & Fertilizers Ltd"])
    r = c.post("/api/evidence/extract", headers=h, files={"file": ("r.txt", b"Moisture 12.5 %\nPurity 92 %", "text/plain")}).json()
    assert r["values"] == {"moisture": 12.5, "purity_pct": 92.0} and r["method"] == "text"
    assert c.post("/api/evidence/extract", files={"file": ("r.txt", b"x", "text/plain")}).status_code == 401


# ---------------------------------------------------------------- vision
def test_descriptor_ranks_similar_materials_higher():
    g = {"features": vision.descriptor(make("gypsum", 1))[0]}
    sim = lambda s: vision.similarity(g, {"features": vision.descriptor(make(s, 2))[0]})["overall"]
    assert sim("phosphogypsum") > sim("bf_slag") > sim("steel_slag")
    assert vision.descriptor(make("steel_slag", 3))[1]["texture"] == "lumpy / coarse"
    assert vision.descriptor(make("bagasse", 3))[1]["texture"] == "fibrous"


def test_photo_upload_strips_metadata_and_is_owner_only(c):
    owner = login(c, EMAIL["Deccan Phosphates & Fertilizers Ltd"])
    other = login(c, EMAIL["NexGen Chakan Data Park"])
    me = c.get("/api/auth/me", headers=owner).json()["industry"]["id"]
    sid = next(s["id"] for s in c.get(f"/api/industries/{me}", headers=owner).json()["waste_streams"] if s["waste_name"] == "Phosphogypsum")
    assert c.post(f"/api/materials/{sid}/images", headers=other, files={"file": ("p.jpg", jpeg(), "image/jpeg")}).status_code == 403
    assert c.post(f"/api/materials/{sid}/images", headers=owner, files={"file": ("p.jpg", b"not an image", "image/jpeg")}).status_code == 400
    r = c.post(f"/api/materials/{sid}/images", headers=owner, files={"file": ("p.jpg", jpeg(exif=True), "image/jpeg")})
    assert r.status_code == 200 and r.json()["traits"]["colour"]
    served = Image.open(io.BytesIO(c.get(r.json()["url"]).content))
    assert 0x010F not in served.getexif()  # EXIF removed before storage
    iid = r.json()["id"]
    assert c.delete(f"/api/images/{iid}", headers=other).status_code == 404  # only the owner can remove
    assert c.delete(f"/api/images/{iid}", headers=owner).status_code == 200
    assert iid not in [p["id"] for p in c.get(f"/api/materials/{sid}/images", headers=owner).json()]
    assert c.get(f"/api/images/{iid}/file").status_code == 404


def test_visual_matches_keep_specification_in_charge(c):
    buyer = login(c, EMAIL["Raigad Cement Works Ltd"])
    me = c.get("/api/auth/me", headers=buyer).json()["industry"]["id"]
    d = next(x for x in c.get(f"/api/industries/{me}", headers=buyer).json()["demands"] if x["material"] == "Mineral gypsum")
    r = c.get(f"/api/demands/{d['id']}/visual-matches", headers=buyer).json()
    res = r["results"]
    assert res[0]["compatible"] and res[0]["material"] in ("Phosphogypsum", "Chemical gypsum")
    incompatible = [x for x in res if not x["compatible"]]
    assert incompatible and all("not compatible" in x["conclusion"] for x in incompatible)
    first_incompat = res.index(incompatible[0])
    assert all(x["compatible"] for x in res[:first_incompat])  # a good-looking photo never outranks a spec-compatible source
    assert "Confidential supplier" in json.dumps(r)
    assert c.get(f"/api/demands/{d['id']}/visual-matches", headers=login(c, EMAIL["NexGen Chakan Data Park"])).status_code == 404


def test_photo_search_identifies_material(c):
    r = c.post("/api/vision/search", files={"file": ("x.jpg", jpeg("steel_slag", 77), "image/jpeg")}).json()
    assert r["predicted"][0]["material"] == "Steel slag" and r["traits"]["texture"] == "lumpy / coarse"


# ---------------------------------------------------------------- processor registry
def test_processor_registration_and_confirmation(c):
    op = login(c, EMAIL["Trident Nitro Compounds Pvt Ltd"])
    body = {"name": "Trident Acid Recovery Unit", "cluster": "Tarapur MIDC", "accepts": ["Spent acid"], "output_label": "Recovered acid",
            "sets": {"acid_pct": 65}, "yield_share": 0.8, "cost_per_tonne": 900, "capacity_tpm": 400, "steps": ["Acid regeneration"]}
    assert c.post("/api/processors", headers=op, json={**body, "accepts": ["Unobtainium"]}).status_code == 400
    p = c.post("/api/processors", headers=op, json=body).json()
    assert p["source"] == "registered" and p["status"] == "unconfirmed"
    assert c.post(f"/api/processors/{p['id']}/confirm", headers=login(c, EMAIL["NexGen Chakan Data Park"])).status_code == 403
    assert c.post(f"/api/processors/{p['id']}/confirm", headers=op).json()["status"] == "confirmed"
    synthetic = next(x for x in c.get("/api/processors").json()["processors"] if x["source"] == "synthetic")
    assert c.post(f"/api/processors/{synthetic['id']}/confirm", headers=op).status_code == 403


# ---------------------------------------------------------------- factor registry
def test_factor_registry_is_sourced_and_facilitator_only(c):
    f = {x["key"]: x for x in c.get("/api/factors").json()["factors"]}
    assert all(x["source"] for x in f.values()) and f["grid_electricity"]["status"] == "default"
    assert impact.transport_factor(f) == pytest.approx(0.00268 * 0.025)
    company = login(c, EMAIL["Konkan Ispat Steel Ltd"])
    assert c.patch("/api/factors/grid_electricity", headers=company, json={"value": 0.7, "source": "x" * 10}).status_code == 403
    r = c.patch("/api/factors/grid_electricity", headers=login(c, FAC), json={"value": 0.71, "source": "CEA CO2 Baseline Database v19", "reference_year": "FY2023-24"}).json()
    assert r["status"] == "reviewed" and r["value"] == 0.71


def test_processing_emissions_use_step_energy_and_grid():
    f = impact.defaults()
    nb = impact.net_benefit(10000, 0.5, 10, [{"step": "Drying", "cost_per_tonne": 1}], f)
    assert nb["processing_emissions"] == pytest.approx(10000 * 90 * 0.716 / 1000, rel=1e-3)
    assert nb["transport_emissions"] == pytest.approx(10000 * 10 * 0.00268 * 0.025, rel=1e-3)


# ---------------------------------------------------------------- reliability from real deliveries
def test_reliability_prefers_platform_deliveries():
    r = reliability([], [{"dispatched": 100, "received": 100, "accepted": 100, "on_time": True},
                         {"dispatched": 100, "received": 80, "accepted": 70, "on_time": False}])
    assert r["basis"] == "platform" and not r["demo_data"] and r["on_time_pct"] == 50 and r["level"] == "low"

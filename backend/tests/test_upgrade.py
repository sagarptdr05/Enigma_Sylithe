"""Tests for the upgrade: assessment, discovery, confidentiality, exchange lifecycle, impact tiers, sourcing, AI safety."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import DATA_DIR
from app.engines import assessment, inference, llm
from app.main import app

DEMO = json.loads((DATA_DIR / "demo_users.json").read_text())
EMAIL = {u["industry"]: u["email"] for u in DEMO["users"] if u.get("industry")}
FACILITATOR = next(u["email"] for u in DEMO["users"] if u.get("role") == "facilitator")
GYPSUM = {"CaO": [28, 35], "moisture": [0, 18], "purity_pct": [85, 100]}


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as client:
        yield client


def auth(c, email):
    r = c.post("/api/auth/login", json={"email": email, "password": DEMO["password"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def stream(**kw):
    base = dict(composition={"CaO": 31, "moisture": 20}, property_sources={"CaO": "ai_inferred", "moisture": "ai_inferred"},
                monthly_tonnes=1000, category="mineral", hazardous=False, disposal_cost_per_tonne=100, verification_status="ai_inferred")
    base.update(kw)
    return SimpleNamespace(**base)


def run(ws, need=500, dist=10, steps=None, evidence=None, price=2600, max_distance=300):
    from app.engines.scoring import Params
    return assessment.assess(ws=ws, evidence=evidence or [], spec=GYPSUM, material="Mineral gypsum", need_tonnes=need, virgin_price=price,
                             virgin_co2=0.12, distance_km=dist, processing_steps=steps or [], regulatory_flags=["MPCB authorisation"],
                             params=Params(max_distance=max_distance))


# ---------------------------------------------------------------- matching / assessment
def test_property_status_pass_fail_unknown():
    a = run(stream())
    st = {r["property"]: r["status"] for r in a["properties"]}
    assert st == {"CaO": "PASS", "moisture": "FAIL", "purity_pct": "UNKNOWN"}  # UNKNOWN is never PASS


def test_processing_can_fix_property_but_not_unknown():
    a = run(stream(), steps=[{"step": "Drying", "cost_per_tonne": 200}])
    st = {r["property"]: r["status"] for r in a["properties"]}
    assert st["moisture"] == "FIXABLE" and st["purity_pct"] == "UNKNOWN"
    tech = next(g for g in a["gates"] if g["key"] == "technical")
    assert tech["status"] == "warn" and "Purity" in tech["text"]


def test_insufficient_quantity_and_distance_and_economics():
    a = run(stream(monthly_tonnes=30), need=500)
    assert next(g for g in a["gates"] if g["key"] == "quantity")["status"] == "fail"
    b = run(stream(), dist=400, max_distance=300)
    assert next(g for g in b["gates"] if g["key"] == "distance")["status"] == "fail" and not b["viable"]
    e = run(stream(disposal_cost_per_tonne=0), price=100, steps=[{"step": "Washing", "cost_per_tonne": 300}])
    assert next(g for g in e["gates"] if g["key"] == "economics")["status"] == "fail"


def test_hazardous_and_missing_evidence_create_blockers():
    a = run(stream(hazardous=True))
    keys = {i["key"]: i["status"] for i in a["evidence"]["items"]}
    assert keys["contamination"] == "missing" and keys["authorisation"] == "missing" and keys["quantity"] == "missing"
    assert a["evidence"]["completeness"] < 0.5
    assert a["readiness"]["main_blocker"]["owner"] == "supplier" and not a["readiness"]["ready"]


def test_evidence_values_override_and_verified_provenance():
    ev = [SimpleNamespace(id=1, status="verified", type="lab_report", reported_values={"purity_pct": 92, "moisture": 12},
                          linked_properties=["purity_pct", "moisture", "CaO"])]
    a = run(stream(verification_status="user_declared"), evidence=ev)
    rows = {r["property"]: r for r in a["properties"]}
    assert rows["purity_pct"]["status"] == "PASS" and rows["purity_pct"]["source"] == "lab_verified"
    assert rows["CaO"]["source"] == "ai_inferred"  # trust levels are not merged


def test_two_sided_economics_add_up():
    a = run(stream())
    e = a["economics"]
    assert e["buyer"]["net_per_unit"] + e["supplier"]["net_per_unit"] == pytest.approx(e["combined_per_unit"])
    assert {l["basis"] for l in e["buyer"]["lines"]} <= {"ESTIMATE", "USER PROVIDED", "VERIFIED"}


# ---------------------------------------------------------------- discovery
def test_discover_alternatives_finds_phosphogypsum_with_purity_blocker(c):
    r = c.post("/api/alternatives/discover", json={"intended_use": "cement production", "current_material": "Virgin gypsum",
                                                   "monthly_tonnes": 500, "cluster": "Taloja MIDC", "max_distance": 150})
    assert r.status_code == 200
    alts = {a["material"]: a for a in r.json()["alternatives"]}
    assert "Phosphogypsum" in alts and alts["Phosphogypsum"]["status"] == "feasible"
    assert "purity" in alts["Phosphogypsum"]["explanation"].lower()
    assert r.json()["applications"][0]["raw_material"] == "Mineral gypsum"


# ---------------------------------------------------------------- confidentiality
def test_confidential_supplier_hidden_everywhere(c):
    name = "Deccan Phosphates & Fertilizers Ltd"
    for url in ["/api/industries?cluster=Taloja%20MIDC", "/api/matches?cluster=Taloja%20MIDC&limit=2000", "/api/graph?cluster=Taloja%20MIDC",
                "/api/graph/loops?cluster=Taloja%20MIDC", "/api/impact", "/api/search/reverse?material=gypsum&lat=19.08&lon=73.12&qty=500"]:
        assert name not in c.get(url).text, url
    body = {"intended_use": "cement production", "current_material": "Virgin gypsum", "monthly_tonnes": 500, "cluster": "Taloja MIDC"}
    assert name not in c.post("/api/alternatives/discover", json=body).text
    # the company itself and the facilitator can see it
    own = auth(c, EMAIL[name])
    assert name in c.get("/api/industries?cluster=Taloja%20MIDC", headers=own).text
    assert name in c.get("/api/industries?cluster=Taloja%20MIDC", headers=auth(c, FACILITATOR)).text


def test_mutual_consent_reveals_identity_one_sided_does_not(c):
    buyer = auth(c, EMAIL["Raigad Cement Works Ltd"])
    supplier = auth(c, EMAIL["Deccan Phosphates & Fertilizers Ltd"])
    res = c.post("/api/alternatives/discover", headers=buyer, json={"intended_use": "cement production", "current_material": "Virgin gypsum",
                                                                      "monthly_tonnes": 500, "max_distance": 150}).json()
    pg = next(a for a in res["alternatives"] if a["material"] == "Phosphogypsum")
    s = next(s for s in pg["streams"] if s["industry"].get("hidden") and s.get("match_id"))
    x = c.post("/api/exchanges", headers=buyer, json={"match_id": s["match_id"], "message": "Interested", "include_stages": ["evidence", "assessment"]}).json()
    assert x["counterparty"]["name"] == "Confidential supplier" and x["counterparty_contact"] is None
    # supplier accepts but keeps identity hidden -> still masked for the buyer
    c.post(f"/api/exchanges/{x['id']}/action", headers=supplier, json={"action": "accept", "reveal_identity": False})
    assert c.get(f"/api/exchanges/{x['id']}", headers=buyer).json()["counterparty"]["name"] == "Confidential supplier"
    c.post(f"/api/exchanges/{x['id']}/action", headers=supplier, json={"action": "consent"})
    after = c.get(f"/api/exchanges/{x['id']}", headers=buyer).json()
    assert after["consent"]["identity_revealed"] and after["counterparty"]["name"] == "Deccan Phosphates & Fertilizers Ltd"
    assert after["counterparty_contact"]["email"]


def test_exchange_idor_and_evidence_file_protection(c):
    outsider = auth(c, EMAIL["NexGen Chakan Data Park"])
    assert c.get("/api/exchanges/1", headers=outsider).status_code == 404
    supplier = auth(c, EMAIL["Deccan Phosphates & Fertilizers Ltd"])
    sid = c.get("/api/auth/me", headers=supplier).json()["industry"]["id"]
    pg = next(s for s in c.get(f"/api/industries/{sid}", headers=supplier).json()["waste_streams"] if s["waste_name"] == "Phosphogypsum")
    bad = c.post(f"/api/materials/{pg['id']}/evidence", headers=supplier, data={"type": "lab_report", "title": "x"},
                 files={"file": ("report.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 400
    ok = c.post(f"/api/materials/{pg['id']}/evidence", headers=supplier,
                data={"type": "lab_report", "title": "Phosphogypsum purity test", "reported_values": json.dumps({"purity_pct": 91, "CaO": 31.5})},
                files={"file": ("report.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert ok.status_code == 200
    assert c.get(f"/api/evidence/{ok.json()['id']}/file", headers=outsider).status_code == 403
    assert c.post(f"/api/materials/{pg['id']}/evidence", headers=outsider, data={"type": "lab_report", "title": "x"}).status_code == 403
    # only a facilitator verifies
    assert c.post(f"/api/evidence/{ok.json()['id']}/verify", headers=supplier, json={"status": "verified"}).status_code == 403
    v = c.post(f"/api/evidence/{ok.json()['id']}/verify", headers=auth(c, FACILITATOR), json={"status": "verified"})
    assert v.status_code == 200 and v.json()["status"] == "verified"


# ---------------------------------------------------------------- exchange lifecycle + impact
def test_full_exchange_lifecycle_and_impact_tiers(c):
    buyer = auth(c, EMAIL["Raigad Cement Works Ltd"])
    supplier = auth(c, EMAIL["Deccan Phosphates & Fertilizers Ltd"])
    xs = c.get("/api/exchanges", headers=buyer).json()["outgoing"]
    x = next(x for x in xs if x["match"]["waste_name"] == "Phosphogypsum")
    xid = x["id"]
    act = lambda h, **b: c.post(f"/api/exchanges/{xid}/action", headers=h, json=b)
    assert act(buyer, action="dispatch", tonnes=10).status_code == 409  # wrong stage
    assert x["stage"] == "evidence"
    assert act(buyer, action="submit_evidence").status_code == 403  # supplier's step
    assert act(supplier, action="submit_evidence").status_code == 200  # evidence uploaded in the previous test
    assert act(buyer, action="record_assessment", result="maybe").status_code == 400
    assert act(buyer, action="record_assessment", result="pass", text="Purity 91% OK").json()["stage"] == "negotiation"
    assert act(supplier, action="accept_offer").status_code == 409  # no offer yet
    act(supplier, action="offer", price=600, tonnes=400)
    assert act(supplier, action="accept_offer").status_code == 409  # own offer
    assert act(buyer, action="accept_offer").json()["stage"] == "agreement"
    act(buyer, action="sign")
    assert act(supplier, action="sign").json()["stage"] == "dispatch"
    before = c.get("/api/impact?cluster=Taloja%20MIDC").json()["tiers"]
    assert before["committed"]["exchanges"] >= 1
    assert act(supplier, action="dispatch", tonnes=400).status_code == 400  # hazardous needs manifest
    act(supplier, action="dispatch", tonnes=400, reference="MPCB/F10/2211")
    assert act(buyer, action="receive", tonnes=500).status_code == 400  # more than dispatched
    act(buyer, action="receive", tonnes=395)
    done = act(buyer, action="accept_delivery").json()
    assert done["status"] == "completed" and done["impact"]["tonnes"] == 395
    tiers = c.get("/api/impact?cluster=Taloja%20MIDC").json()["tiers"]
    assert tiers["reported"]["tonnes"] >= 395 and tiers["potential"]["tonnes"] > tiers["committed"]["tonnes"]
    assert act(auth(c, FACILITATOR), action="verify_impact").status_code == 200
    assert c.get("/api/impact?cluster=Taloja%20MIDC").json()["tiers"]["verified"]["tonnes"] >= 395
    rep = c.post(f"/api/exchanges/{xid}/repeat", headers=buyer).json()
    assert rep["repeat_of"] == xid and rep["terms"]["offer"]["price"] == 600 and "evidence" not in rep["stages"]


# ---------------------------------------------------------------- sourcing
def test_sourcing_request_leads_stay_unconfirmed_until_company_confirms(c):
    buyer = auth(c, EMAIL["Raigad Cement Works Ltd"])
    r = c.post("/api/sourcing-requests", headers=buyer, json={"material": "Iron ore corrective", "intended_use": "cement production",
                                                               "monthly_tonnes": 300, "radius_km": 150}).json()
    cand = c.get(f"/api/sourcing-requests/{r['id']}", headers=buyer).json()
    assert all(p["label"].startswith("Potential supplier") for p in cand["potential"])
    lead_stream = next(p for p in cand["potential"] if not p["industry"].get("hidden"))
    assert c.post(f"/api/sourcing-requests/{r['id']}/invite", headers=buyer, json={"waste_stream_id": lead_stream["waste_stream_id"]}).status_code == 200
    other = auth(c, EMAIL["NexGen Chakan Data Park"])
    assert c.get(f"/api/sourcing-requests/{r['id']}", headers=other).status_code == 404


# ---------------------------------------------------------------- network + AI safety
def test_network_gaps_funnel_is_monotonic(c):
    g = c.get("/api/network/gaps?cluster=Tarapur%20MIDC").json()
    counts = [f["count"] for f in g["funnel"]]
    assert counts == sorted(counts, reverse=True) and g["bottleneck"]["explanation"]
    edges = c.get("/api/graph?cluster=Tarapur%20MIDC").json()["links"]
    assert {"INFERRED", "POTENTIAL"} & {e["status"] for e in edges} and "COMPLETED" in {e["status"] for e in edges}


def test_llm_malformed_missing_key_and_hallucinated_fields(monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "_complete", lambda *a, **k: "Sure! here is prose, not JSON")
    assert llm.extract_byproducts("steel", 100, "t", "blast furnace") == []
    monkeypatch.setattr(llm, "_complete", lambda *a, **k: json.dumps([{"waste_name": "<b>Blast furnace slag</b>", "estimated_monthly_tonnes": -5,
                                                                       "confidence": 7, "reasoning": "<script>x</script>ok", "category": "bogus"}]))
    items = inference._llm_items({"type": "steel", "capacity": 1000, "capacity_unit": "t"}, "blast furnace")
    assert items[0]["waste_name"] == "BF slag" and items[0]["confidence"] == 1.0 and "<" not in items[0]["reasoning"]
    assert items[0]["monthly_tonnes"] > 0 and items[0]["verification_status"] == "ai_inferred"
    monkeypatch.setattr(llm, "available", lambda: False)
    assert llm.extract_byproducts("steel", 100, "t", "x") == []  # missing key -> deterministic fallback

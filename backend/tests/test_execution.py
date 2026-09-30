"""Buyer-side execution: landed cost, supply assurance, qualification, trial planner, batches, routes, impact."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import DATA_DIR
from app.engines import scoring
from app.engines.costing import CostInputs, landed_cost, processing_yield
from app.engines.qualification import eligibility, evidence_state, generate_checklist
from app.engines.supply import allocate, coverage, freshness, reliability
from app.main import app

DEMO = json.loads((DATA_DIR / "demo_users.json").read_text())
EMAIL = {u["industry"]: u["email"] for u in DEMO["users"] if u.get("industry")}


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as client:
        yield client


def login(c, email):
    return {"Authorization": f"Bearer {c.post('/api/auth/login', json={'email': email, 'password': DEMO['password']}).json()['token']}"}


# ---------------------------------------------------------------- landed cost
def test_landed_cost_uses_usable_tonnes():
    ci = CostInputs(material_price=1800, material_price_basis="USER PROVIDED", distance_km=0, loading_unloading=0, handling=0, storage=0,
                    testing_per_month=0, monthly_tonnes=100, acceptance_yield=0.9, baseline_price=2500)
    r = landed_cost(ci)
    assert r["cost_per_usable_tonne"] == pytest.approx(2000)  # ₹1,80,000 / 90 usable tonnes
    assert r["usable_tonnes_per_month"] == pytest.approx(90) and r["verdict"] == "cheaper"


def test_no_saving_claimed_when_key_inputs_missing():
    r = landed_cost(CostInputs(material_price=None, material_price_basis="ESTIMATE", distance_km=10, monthly_tonnes=100, baseline_price=None))
    assert r["verdict"] == "insufficient_data" and r["saving_per_usable_tonne"] is None


def test_processing_yield_compounds():
    assert processing_yield([{"step": "Drying", "cost_per_tonne": 1}, {"step": "Grinding", "cost_per_tonne": 1}]) == pytest.approx(0.92 * 0.99, abs=1e-4)


# ---------------------------------------------------------------- supply assurance
def test_coverage_shortfall_and_capacity_safe_allocation():
    assert coverage(100, 60) == {"coverage_pct": 60.0, "shortfall": 40.0}
    plan = allocate(100, [{"id": 1, "capacity": 60, "cost": 2000, "eligible": True, "qualified": True},
                          {"id": 2, "capacity": 25, "cost": 1500, "eligible": True, "qualified": False},
                          {"id": 3, "capacity": 999, "cost": 100, "eligible": False, "qualified": True}])
    assert [p["tonnes"] for p in plan["plan"]] == [60, 25] and plan["uncovered"] == 15  # never exceeds capacity, ineligible skipped
    assert plan["single_source_risk"]


def test_reliability_not_established_without_history_and_freshness():
    assert reliability([])["level"] == "not_established"
    recs = [SimpleNamespace(available_tonnes=100, committed_tonnes=50, delivered_tonnes=50, on_time=True, source="demo") for _ in range(6)]
    assert reliability(recs)["level"] == "high"
    assert freshness(None)["status"] == "never_confirmed" and freshness("2020-01-01T00:00:00+00:00")["status"] == "stale"


# ---------------------------------------------------------------- qualification
def test_evidence_states():
    e = lambda **k: SimpleNamespace(**{"status": "submitted", "type": "lab_report", "expiry_date": None, "issue_date": None, **k})
    assert evidence_state(e(expiry_date="2020-01-01"))["state"] == "expired"
    assert evidence_state(e(issue_date="2020-01-01"))["state"] == "revalidation_required"
    assert evidence_state(e(status="verified", issue_date="2099-01-01"))["state"] == "accepted"
    assert evidence_state(e())["state"] == "under_review"


def test_critical_failure_blocks_eligibility_regardless_of_score():
    a = {"properties": [{"label": "Moisture", "actual": 30, "min": 0, "max": 10, "status": "FAIL"}], "gates": [{"status": "ok", "text": "", "key": "economics"}]}
    assert eligibility(a)["status"] == "not_eligible"
    a["properties"][0]["status"] = "UNKNOWN"
    assert eligibility(a)["status"] == "conditional"


def test_checklist_generated_from_gaps():
    a = {"properties": [{"label": "Purity", "status": "UNKNOWN", "min": 85, "max": 100}, {"label": "CaO", "status": "PASS", "min": 1, "max": 2}],
         "evidence": {"items": [{"label": "Composition lab report", "status": "missing", "action": "Upload"}]}}
    items = generate_checklist(assessment=a, processing_steps=[{"step": "Drying", "cost_per_tonne": 200}], category="mineral", hazardous=True,
                               monthly_tonnes=400, include_sample=True, include_trial=True)
    kinds = [i["kind"] for i in items]
    assert "lab_test" in kinds and "trial" in kinds and kinds[-1] == "decision"
    assert any("Purity" in i["title"] for i in items) and not any("CaO" in i["title"] for i in items if i["kind"] == "lab_test")


# ---------------------------------------------------------------- time machine uses the same engine
def test_time_machine_levers_change_viability():
    cand = dict(distance_km=10.0, virgin_price=2000.0, virgin_co2=0.8, processing_cost=1500.0, disposal=0.0, technical_fit=0.6,
                timing=1.0, hazardous=False, supply=100.0, demand=60.0)
    assert scoring.score_one(cand, scoring.Params(), 0.8) is not None
    assert scoring.score_one(cand, scoring.Params(processing_multiplier=1.4), 0.8) is None
    assert scoring.score_one(cand, scoring.Params(min_technical_fit=0.7), 0.8) is None
    assert scoring.score_one(cand, scoring.Params(supply_multiplier=0.5), 0.8)["tradable_tonnes"] == 50


# ---------------------------------------------------------------- API: qualification, backups, routes, batches
def test_match_qualification_backups_and_routes(c):
    buyer = login(c, EMAIL["Raigad Cement Works Ltd"])
    me = c.get("/api/auth/me", headers=buyer).json()["industry"]["id"]
    detail = c.get(f"/api/industries/{me}", headers=buyer).json()
    gypsum = next(d for d in detail["demands"] if d["material"] == "Mineral gypsum")
    mid = gypsum["top_suppliers"][0]["id"]
    a = c.get(f"/api/matches/{mid}/assessment", headers=buyer).json()
    assert a["eligibility"]["status"] in ("eligible", "conditional", "not_eligible")
    assert sum(f["weight"] for f in a["factors"]["factors"]) == 100
    assert a["landed_cost"]["cost_per_usable_tonne"] > 0 and a["supply"]["reliability"]["level"]
    b = c.get(f"/api/matches/{mid}/backups").json()
    assert all(p["tonnes"] <= next(o["capacity"] for o in b["options"] if o["id"] == p["id"]) + 1e-6 for p in b["allocation"]["plan"])
    r = c.get(f"/api/matches/{mid}/routes").json()["routes"]
    assert r and all(route["status"] == "hypothesis" for route in r)
    assert all(x["status"] != "FAIL" for route in r for x in route["properties_after"])
    lc = c.post(f"/api/matches/{mid}/landed-cost", json={"material_price": 0, "acceptance_yield": 0.5}).json()
    assert lc["usable_share"] <= 0.5


def test_batch_rejection_partial_acceptance_and_terms(c):
    steel = login(c, EMAIL["Konkan Ispat Steel Ltd"])
    cement = login(c, EMAIL["Boisar Portland Cements Ltd"])
    me = c.get("/api/auth/me", headers=steel).json()["industry"]["id"]
    cement_id = c.get("/api/auth/me", headers=cement).json()["industry"]["id"]
    ms = c.get(f"/api/matches?industry_id={me}&limit=2000").json()
    x = None
    for m in [x for x in ms if x["src_id"] == me and x["dst_id"] == cement_id]:
        r = c.post("/api/exchanges", headers=steel, json={"match_id": m["id"], "include_stages": []})
        if r.status_code == 200:  # first steel -> cement match without an open exchange (other tests may hold one)
            x = r.json()
            break
    assert x is not None
    assert x["checklist"] and x["responsibilities"]["nonconforming_batch_replacement"] == "supplier"
    act = lambda h, **b: c.post(f"/api/exchanges/{x['id']}/action", headers=h, json=b)
    other = cement
    act(other, action="accept")
    act(steel, action="offer", price=1000, tonnes=100)
    act(other, action="accept_offer")
    act(steel, action="sign")
    r = act(other, action="set_terms", responsibilities={"transport": "shared"})
    assert r.json()["terms"]["signatures"] == {}  # changed terms reset signatures
    act(steel, action="sign"); act(other, action="sign")
    act(steel, action="dispatch", tonnes=100)
    act(other, action="receive", tonnes=100)
    bad = act(other, action="reject_delivery", text="Oil content high", corrective_action="De-oil and resend")
    assert bad.json()["stage"] == "dispatch" and bad.json()["batches"][0]["status"] == "rejected"
    act(steel, action="dispatch", tonnes=100)
    act(other, action="receive", tonnes=100)
    assert act(other, action="accept_delivery", accepted_tonnes=90, rejected_tonnes=20).status_code == 400
    done = act(other, action="accept_delivery", accepted_tonnes=95, rejected_tonnes=5, values={"CaO": 40}).json()
    assert done["status"] == "completed" and done["batches"][-1]["status"] == "partial"
    assert done["impact_record"]["reported"]["tonnes"] == 95 and done["impact_record"]["verified"]["status"] == "not_verified"
    assert act(other, action="record_use", tonnes=200).status_code == 400
    assert act(other, action="record_use", tonnes=90).status_code == 200
    item = done["checklist"][-1]
    assert item["kind"] == "decision"


def test_availability_refresh_is_owner_only_and_timestamped(c):
    steel = login(c, EMAIL["Konkan Ispat Steel Ltd"])
    other = login(c, EMAIL["NexGen Chakan Data Park"])
    me = c.get("/api/auth/me", headers=steel).json()["industry"]["id"]
    sid = next(s["id"] for s in c.get(f"/api/industries/{me}", headers=steel).json()["waste_streams"] if s["waste_name"] == "BF slag")
    assert c.post(f"/api/materials/{sid}/availability", headers=other, json={"available_tonnes": 1}).status_code == 403
    r = c.post(f"/api/materials/{sid}/availability", headers=steel, json={"available_tonnes": 17500, "min_order_tonnes": 800}).json()
    assert r["freshness"]["status"] == "fresh" and r["min_order"] == 800

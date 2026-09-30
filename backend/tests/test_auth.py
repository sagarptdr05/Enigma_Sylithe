import json

from fastapi.testclient import TestClient

from app.config import DATA_DIR
from app.main import app

DEMO = json.loads((DATA_DIR / "demo_users.json").read_text())


def login(c, email):
    r = c.post("/api/auth/login", json={"email": email, "password": DEMO["password"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_auth_and_deal_flow():
    with TestClient(app) as c:
        assert c.get("/api/auth/me").status_code == 401
        assert c.post("/api/auth/login", json={"email": DEMO["users"][0]["email"], "password": "wrong-pass"}).status_code == 401
        steel = login(c, DEMO["users"][0]["email"])
        me = c.get("/api/auth/me", headers=steel).json()
        assert me["industry"]["name"] == "Konkan Ispat Steel Ltd"
        box = c.get("/api/inquiries", headers=steel).json()
        assert box["pending_incoming"] >= 1 and len(box["outgoing"]) >= 1
        assert box["incoming"][0]["counterparty_contact"] is None  # hidden until accepted

        # steel sends an offer on its best slag match; the buyer accepts and contacts are revealed
        detail = c.get(f"/api/industries/{me['industry']['id']}").json()
        slag = next(s for s in detail["waste_streams"] if s["waste_name"] == "BF slag")
        m = slag["top_matches"][0]
        r = c.post("/api/inquiries", json={"match_id": m["id"], "message": "Trial lot?"}, headers=steel)
        assert r.status_code == 200 and r.json()["kind"] == "offer"
        assert c.post("/api/inquiries", json={"match_id": m["id"]}, headers=steel).status_code == 409
        qid = r.json()["id"]
        assert c.patch(f"/api/inquiries/{qid}", json={"status": "accepted"}, headers=steel).status_code == 403

        reg = c.post("/api/auth/register", json={
            "email": "new@plant.test", "password": "longpassword", "contact_name": "Test User",
            "industry": {"name": "New Cement", "type": "cement", "cluster": "Tarapur MIDC", "lat": 19.81, "lon": 72.72, "capacity": 50000}})
        assert reg.status_code == 200 and reg.json()["matches_created"] > 0
        assert c.post("/api/auth/register", json={
            "email": "new@plant.test", "password": "longpassword", "contact_name": "Dup",
            "industry": {"name": "X", "type": "cement", "cluster": "Tarapur MIDC", "lat": 19.81, "lon": 72.72, "capacity": 1}}).status_code == 409

        buyer_id = m["buyer"]["id"]
        buyer_user = next((u for u in c.get("/api/auth/demo-accounts").json() if u["industry"]["id"] == buyer_id), None)
        if buyer_user:
            tok = c.post("/api/auth/demo-login", json={"user_id": buyer_user["user_id"]}).json()["token"]
            h = {"Authorization": f"Bearer {tok}"}
            ok = c.patch(f"/api/inquiries/{qid}", json={"status": "accepted", "reply": "Send samples"}, headers=h).json()
            assert ok["status"] == "accepted" and ok["counterparty_contact"]["email"]

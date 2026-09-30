"""Notifications: the other party is alerted (never the actor), alerts are private, no names leak, email goes to the outbox."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from app import config
from app.config import DATA_DIR
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


def inbox(c, h):
    return c.get("/api/notifications", headers=h).json()


def test_exchange_actions_alert_the_other_party_only(c):
    buyer, supplier = login(c, EMAIL["Raigad Cement Works Ltd"]), login(c, EMAIL["Deccan Phosphates & Fertilizers Ltd"])
    c.post("/api/notifications/read", headers=supplier, json={})
    c.post("/api/notifications/read", headers=buyer, json={})
    res = c.post("/api/alternatives/discover", headers=buyer, json={"intended_use": "cement production", "current_material": "Virgin gypsum",
                                                                     "monthly_tonnes": 500, "max_distance": 150}).json()
    pg = next(a for a in res["alternatives"] if a["material"] == "Phosphogypsum")
    s = next(s for s in pg["streams"] if s["industry"].get("hidden") and s.get("match_id"))
    for x in c.get("/api/exchanges", headers=buyer).json()["outgoing"]:  # clear an open exchange from earlier tests
        if x["match_id"] == s["match_id"] and x["status"] in ("pending", "accepted"):
            c.post(f"/api/exchanges/{x['id']}/action", headers=buyer, json={"action": "withdraw", "text": "test reset"})
    x = c.post("/api/exchanges", headers=buyer, json={"match_id": s["match_id"], "message": "Interested"}).json()

    sup = inbox(c, supplier)
    assert sup["unread"] >= 1
    n = sup["items"][0]
    assert n["link"] == f"/exchange/{x['id']}" and "request from a buyer" in n["body"] and not n["read"]
    assert "Raigad" not in n["title"] + n["body"]  # no company names in alerts
    assert inbox(c, buyer)["unread"] == 0  # the actor is not alerted about their own action

    c.post(f"/api/exchanges/{x['id']}/action", headers=supplier, json={"action": "comment", "text": "Lab report next week"})
    b = inbox(c, buyer)
    assert b["unread"] == 1 and "Lab report next week" in b["items"][0]["body"]

    # read state is per user and cannot touch someone else's alerts
    other = login(c, EMAIL["NexGen Chakan Data Park"])
    assert c.post("/api/notifications/read", headers=other, json={"ids": [b["items"][0]["id"]]}).json()["marked"] == 0
    assert c.post("/api/notifications/read", headers=buyer, json={"ids": [b["items"][0]["id"]]}).json()["marked"] == 1
    assert inbox(c, buyer)["unread"] == 0

    # asking for help alerts the facilitator too
    fac = login(c, FAC)
    before = inbox(c, fac)["unread"]
    c.post(f"/api/exchanges/{x['id']}/action", headers=buyer, json={"action": "request_facilitation"})
    assert inbox(c, fac)["unread"] == before + 1
    c.post(f"/api/exchanges/{x['id']}/action", headers=buyer, json={"action": "withdraw", "text": "test done"})  # leave the match free


def test_email_goes_to_outbox_and_respects_preference(c):
    buyer, supplier = login(c, EMAIL["Konkan Ispat Steel Ltd"]), login(c, EMAIL["Boisar Portland Cements Ltd"])
    assert c.patch("/api/notifications/preferences", headers=supplier, json={"email_alerts": False}).json()["email_alerts"] is False
    assert inbox(c, supplier)["email_alerts"] is False and inbox(c, supplier)["email_mode"] == "outbox"
    c.patch("/api/notifications/preferences", headers=supplier, json={"email_alerts": True})

    before = set(config.OUTBOX_DIR.glob("*.eml")) if config.OUTBOX_DIR.exists() else set()
    done = next(x for x in c.get("/api/exchanges", headers=supplier).json()["incoming"] + c.get("/api/exchanges", headers=supplier).json()["outgoing"]
                if x["status"] == "completed")
    c.post(f"/api/exchanges/{done['id']}/action", headers=buyer, json={"action": "comment", "text": "Next quarter volumes?"})
    for _ in range(40):  # email is written by a background thread
        new = set(config.OUTBOX_DIR.glob("*.eml")) - before if config.OUTBOX_DIR.exists() else set()
        if new:
            break
        time.sleep(0.05)
    assert new
    text = next(iter(new)).read_text()
    assert "Next quarter volumes?" in text and f"/exchange/{done['id']}" in text


def test_sourcing_and_evidence_alerts(c):
    fac = login(c, FAC)
    owner = login(c, EMAIL["Deccan Phosphates & Fertilizers Ltd"])
    me = c.get("/api/auth/me", headers=owner).json()["industry"]["id"]
    sid = next(s["id"] for s in c.get(f"/api/industries/{me}", headers=owner).json()["waste_streams"] if s["waste_name"] == "Phosphogypsum")
    before = inbox(c, fac)["unread"]
    ev = c.post(f"/api/materials/{sid}/evidence", headers=owner, data={"type": "lab_report", "title": "Alert test report"})
    assert ev.status_code == 200 and inbox(c, fac)["unread"] == before + 1
    c.post("/api/notifications/read", headers=owner, json={})
    c.post(f"/api/evidence/{ev.json()['id']}/verify", headers=fac, json={"status": "rejected", "notes": "No issuer stated"})
    n = inbox(c, owner)["items"][0]
    assert n["title"].startswith("Evidence rejected") and "No issuer stated" in n["body"] and n["link"] == f"/material/{sid}"


def test_notifications_require_login(c):
    assert c.get("/api/notifications").status_code == 401

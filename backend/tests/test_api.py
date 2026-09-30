from fastapi.testclient import TestClient

from app.main import app


def test_end_to_end():
    with TestClient(app) as c:
        assert c.get("/api/health").json()["status"] == "ok"
        hero = c.get("/api/industries/21").json()
        assert hero["name"] == "Konkan Ispat Steel Ltd"
        hidden = {s["waste_name"] for s in hero["waste_streams"] if s["source"] != "declared"}
        assert {"BF slag", "Mill scale"} <= hidden
        loops = c.get("/api/graph/loops", params={"cluster": "Tarapur MIDC"}).json()
        assert any(l["length"] >= 3 for l in loops["loops"])
        m = c.get("/api/matches", params={"limit": 1}).json()[0]
        detail = c.get(f"/api/matches/{m['id']}").json()
        assert detail["explanation"] and len(detail["seasonality"]["supply"]) == 12
        sim = c.post("/api/simulate", json={"cluster": "Tarapur MIDC", "params": {"max_distance": 20}}).json()
        assert sim["viable_count"] < sim["baseline_count"]
        new = c.post("/api/industries", json={"name": "Test Sugar", "type": "sugar_mill", "cluster": "Kolhapur Agro Belt",
                                              "lat": 16.7, "lon": 74.3, "capacity": 200000}).json()
        assert new["matches_created"] > 0

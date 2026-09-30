"""Load the JSON knowledge base and industries into SQLite."""
import json

from sqlalchemy.orm import Session

from ..config import DATA_DIR
from ..models import DemandKB, Industry, WasteKB


def load_json(name: str):
    return json.loads((DATA_DIR / name).read_text())


def seed(db: Session) -> list[dict]:
    """Seed KB tables + industries. Returns raw industry dicts (with declared_wastes)."""
    raw = load_json("industries.json")
    if db.query(Industry).count() > 0:
        return raw
    db.add_all(WasteKB(**row) for row in load_json("waste_kb.json"))
    db.add_all(DemandKB(**row) for row in load_json("demand_kb.json"))
    for row in raw:
        db.add(Industry(**{k: v for k, v in row.items() if k != "declared_wastes"}))
    db.commit()
    return raw


if __name__ == "__main__":
    from ..database import Base, SessionLocal, engine

    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        seed(s)
        print("industries:", s.query(Industry).count(), "waste_kb:", s.query(WasteKB).count())


def seed_demo_users(db: Session) -> int:
    """Idempotent demo scenario: company accounts, one facilitator, evidence and exchanges at different stages."""
    from ..auth import hash_password, now_iso
    from ..engines.exchange import build_stages
    from ..models import Demand, Evidence, ExchangeEvent, Inquiry, Match, User, WasteStream

    data = load_json("demo_users.json")
    pw = None
    by_name = {i.name: i for i in db.query(Industry).all()}
    existing = {u.email for u in db.query(User).all()}
    added = 0
    for u in data["users"]:
        if u["email"] in existing:
            continue
        ind = by_name.get(u["industry"]) if u.get("industry") else None
        if u.get("industry") and not ind:
            continue
        pw = pw or hash_password(data["password"])
        db.add(User(email=u["email"], password_hash=pw, contact_name=u["contact_name"], designation=u["designation"], phone=u["phone"],
                    industry_id=ind.id if ind else None, is_demo=True, role=u.get("role", "company")))
        if ind and u.get("visibility"):
            ind.visibility = u["visibility"]
        added += 1
    db.flush()

    for e in data.get("evidence", []):
        ind = by_name.get(e["industry"])
        s = ind and db.query(WasteStream).filter_by(industry_id=ind.id, waste_name=e["waste"]).first()
        if not s or db.query(Evidence).filter_by(waste_stream_id=s.id, title=e["title"]).first():
            continue
        db.add(Evidence(waste_stream_id=s.id, uploaded_by_industry_id=ind.id, type=e["type"], title=e["title"], linked_properties=sorted(e["values"]),
                        reported_values=e["values"], status=e["status"], verified_by="MIDC Symbiosis Cell" if e["status"] == "verified" else None,
                        uploaded_at=now_iso(), issuer=e.get("issuer"), issue_date=e.get("issue_date"), test_method=e.get("test_method")))
        s.verification_status = "verified" if e["status"] == "verified" else "user_declared"

    for q in data["inquiries"]:
        a, b = by_name.get(q["from"]), by_name.get(q["to"])
        if not a or not b:
            continue
        seller, buyer = (a, b) if q["kind"] == "offer" else (b, a)
        m = (db.query(Match).join(WasteStream, Match.waste_stream_id == WasteStream.id).join(Demand, Match.demand_id == Demand.id)
             .filter(WasteStream.industry_id == seller.id, Demand.industry_id == buyer.id, WasteStream.waste_name == q["waste"])
             .order_by(Match.score.desc()).first())
        if not m or db.query(Inquiry).filter_by(match_id=m.id, from_industry_id=a.id).first():
            continue
        stages = build_stages(["evidence", "assessment"])
        target = q.get("stage", "interest")
        done = stages[: stages.index(target)]
        agreed = q.get("agreed") or {}
        x = Inquiry(match_id=m.id, from_industry_id=a.id, to_industry_id=b.id, kind=q["kind"], monthly_tonnes=agreed.get("tonnes") or m.tradable_tonnes,
                    message=q["message"], status="completed" if target == "completed" else ("pending" if target == "interest" else "accepted"),
                    created_at=now_iso(), updated_at=now_iso(), stage=target, stages=stages,
                    supplier_consent=target != "interest" or q["kind"] == "offer", buyer_consent=target != "interest" or q["kind"] == "request",
                    agreed_price=agreed.get("price"), agreed_tonnes=agreed.get("tonnes"), dispatched_tonnes=q.get("dispatched"),
                    received_tonnes=q.get("received"), signatures={"supplier": now_iso(), "buyer": now_iso()} if "agreement" in done else {},
                    stage_data={"seed": q["key"], **({"offer": q["offer"]} if q.get("offer") else {}),
                                **{st: {"result": "pass", "notes": "Seeded demo history"} for st in ("assessment",) if st in done}},
                    completed_at=now_iso() if target == "completed" else None)
        db.add(x)
        db.flush()
        db.add(ExchangeEvent(inquiry_id=x.id, stage="interest", kind="transition", actor_industry_id=a.id, text="Opportunity discovered by Sylithex", data={"to": "discovery"}, created_at=now_iso()))
        notes = {"interest": "Interest accepted, identities revealed", "evidence": "Evidence package submitted", "assessment": "Assessment passed",
                 "negotiation": f"Offer accepted: ₹{agreed.get('price', 0):,.0f}/t, {agreed.get('tonnes', 0):,.0f} t/month", "agreement": "Agreement signed by both parties",
                 "dispatch": f"Dispatched {q.get('dispatched', 0):,.0f} t", "receipt": f"Received {q.get('received', 0):,.0f} t at the gate",
                 "acceptance": "Delivery accepted: exchange completed and impact recorded"}
        for st in done:
            db.add(ExchangeEvent(inquiry_id=x.id, stage=st, kind="transition", actor_industry_id=None, text=notes.get(st, st), data={"from": st}, created_at=now_iso()))
        added += 1
    db.commit()
    return added



def seed_execution(db: Session) -> None:
    """Demo data for buyer-side execution (idempotent, labelled 'demo'): availability timestamps, supply history,
    batches of the completed exchange, trial checklists and one independently verified impact record."""
    import random
    from datetime import datetime, timedelta, timezone

    from ..models import Batch, ChecklistItem, Inquiry, SupplyRecord, WasteStream
    from ..routers.exchanges import DEFAULT_RESPONSIBILITIES, ensure_checklist

    now = datetime.now(timezone.utc)
    if db.query(SupplyRecord).count():
        return
    by_name = {i.name: i for i in db.query(Industry).all()}
    for s in db.query(WasteStream).all():
        if s.verification_status in ("user_declared", "verified") and not s.availability_updated_at:
            s.availability_updated_at = (now - timedelta(days=(s.id * 37) % 200 + 3)).isoformat(timespec="seconds")

    def stream(company, waste):
        ind = by_name.get(company)
        return ind and db.query(WasteStream).filter_by(industry_id=ind.id, waste_name=waste).first()

    rnd = random.Random(7)
    months = [(now.replace(day=1) - timedelta(days=30 * i)).strftime("%Y-%m") for i in range(12, 0, -1)]
    demo = [("Deccan Phosphates & Fertilizers Ltd", "Phosphogypsum", 12, 200, "Mon-Sat, 08:00-18:00, Taloja gate 3", False),
            ("Krishi Rasayan Fertilizers Pvt Ltd", "Phosphogypsum", 150, 500, None, False),
            ("Konkan Ispat Steel Ltd", "BF slag", 8, 1000, "24x7 rail siding and road", True),
            ("Konkan Ispat Steel Ltd", "Steel slag", 40, 500, None, False),
            ("Shri Panchganga Sahakari Sakhar Karkhana Ltd", "Bagasse", 20, 300, "Crushing season Nov-Apr", True)]
    for company, waste, age, min_order, window, delivered in demo:
        s = stream(company, waste)
        if not s:
            continue
        s.availability_updated_at = (now - timedelta(days=age)).isoformat(timespec="seconds")
        s.min_order_tonnes, s.delivery_window = min_order, window
        if s.verification_status == "ai_inferred" and age < 90:
            s.verification_status = "user_declared"
        for i, mth in enumerate(months):
            season = (s.seasonality or [1] * 12)[int(mth[5:]) - 1]
            avail = round(s.monthly_tonnes * season * rnd.uniform(0.82, 1.08), 1)
            rec = SupplyRecord(waste_stream_id=s.id, month=mth, available_tonnes=avail, source="demo", recorded_at=now.isoformat(timespec="seconds"))
            if delivered and i >= 6 and avail > 0:
                rec.committed_tonnes = round(min(avail, s.monthly_tonnes * 0.6), 1)
                rec.delivered_tonnes = round(rec.committed_tonnes * rnd.uniform(0.9, 1.0), 1)
                rec.on_time = i != 8  # one late month
            db.add(rec)

    for q in db.query(Inquiry).all():
        seed = (q.stage_data or {}).get("seed")
        q.responsibilities = q.responsibilities or dict(DEFAULT_RESPONSIBILITIES)
        q.acceptance_criteria = q.acceptance_criteria or dict(q.match.demand.spec or {})
        db.flush()
        if q.status == "pending":
            continue
        ensure_checklist(db, q)
        db.flush()
        items = db.query(ChecklistItem).filter_by(inquiry_id=q.id).all()
        done_all = q.stage in ("dispatch", "receipt", "acceptance", "completed")
        for it in items:
            if done_all or (q.stage == "negotiation" and it.kind in ("review", "document", "production")):
                it.status, it.completed_by, it.completed_at = "done", "buyer" if it.owner == "buyer" else "supplier", now.isoformat(timespec="seconds")
        if seed == "bf-slag-completed" and not db.query(Batch).filter_by(inquiry_id=q.id).count():
            t0 = now - timedelta(days=40)
            db.add(Batch(inquiry_id=q.id, batch_code=f"X{q.id}-B01", dispatched_tonnes=6000, dispatched_at=t0.isoformat(timespec="seconds"),
                         promised_date=(t0 + timedelta(days=1)).date().isoformat(), received_tonnes=6000, received_at=(t0 + timedelta(days=1)).isoformat(timespec="seconds"),
                         test_values={"CaO": 40.1, "SiO2": 34.2, "moisture": 11.0}, test_date=(t0 + timedelta(days=1)).date().isoformat(),
                         accepted_tonnes=5700, rejected_tonnes=300, status="partial",
                         rejection_reason="300 t from an uncovered stockpile had 11% moisture (limit 10%)",
                         corrective_action="Supplier covers stockpile before monsoon; 300 t replaced in the next batch at no cost"))
            t1 = now - timedelta(days=20)
            db.add(Batch(inquiry_id=q.id, batch_code=f"X{q.id}-B02", dispatched_tonnes=5850, dispatched_at=t1.isoformat(timespec="seconds"),
                         promised_date=(t1 + timedelta(days=1)).date().isoformat(), received_tonnes=5850, received_at=(t1 + timedelta(days=1)).isoformat(timespec="seconds"),
                         test_values={"CaO": 40.6, "SiO2": 33.9, "moisture": 7.8}, test_date=(t1 + timedelta(days=1)).date().isoformat(),
                         accepted_tonnes=5850, rejected_tonnes=0, status="accepted"))
            q.acceptance_criteria = {"CaO": [32, 48], "SiO2": [28, 40], "moisture": [0, 10]}
            q.used_tonnes = 11000
            q.impact_verified_by, q.impact_verified_at = "Anil Kadam (MIDC Symbiosis Cell)", now.isoformat(timespec="seconds")
    db.commit()

"""Tiny additive schema migrator for SQLite.

Fresh databases are built by `create_all` (already at the latest schema) and stamped with the current version.
Existing databases are upgraded step by step with ALTER TABLE ADD COLUMN; data is never dropped.
"""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

log = logging.getLogger("sylithex.migrations")

# version -> list of (table, column, DDL type/default)
COLUMNS = {
    2: [
        ("industries", "visibility", "VARCHAR(20) DEFAULT 'public'"),
        ("waste_streams", "verification_status", "VARCHAR(30) DEFAULT 'ai_inferred'"),
        ("waste_streams", "property_sources", "JSON DEFAULT '{}'"),
        ("waste_streams", "assumptions", "JSON DEFAULT '[]'"),
        ("waste_streams", "physical_state", "VARCHAR(30)"),
        ("users", "role", "VARCHAR(20) DEFAULT 'company'"),
        ("inquiries", "stage", "VARCHAR(20) DEFAULT 'interest'"),
        ("inquiries", "stages", "JSON DEFAULT '[]'"),
        ("inquiries", "supplier_consent", "BOOLEAN DEFAULT 0"),
        ("inquiries", "buyer_consent", "BOOLEAN DEFAULT 0"),
        ("inquiries", "agreed_price", "FLOAT"),
        ("inquiries", "agreed_tonnes", "FLOAT"),
        ("inquiries", "dispatched_tonnes", "FLOAT"),
        ("inquiries", "received_tonnes", "FLOAT"),
        ("inquiries", "signatures", "JSON DEFAULT '{}'"),
        ("inquiries", "stage_data", "JSON DEFAULT '{}'"),
        ("inquiries", "completed_at", "VARCHAR(40)"),
        ("inquiries", "repeat_of", "INTEGER"),
    ],
}


def _users_nullable_industry(conn) -> None:
    """v3: facilitator accounts have no plant, so users.industry_id becomes nullable (SQLite needs a table rebuild)."""
    cols = {c["name"]: c for c in inspect(conn).get_columns("users")}
    if cols["industry_id"]["nullable"]:
        return
    from .models import User

    names = ", ".join(cols)
    conn.execute(text("PRAGMA legacy_alter_table=ON"))
    conn.execute(text("ALTER TABLE users RENAME TO users_v2"))
    for ix in inspect(conn).get_indexes("users_v2"):
        conn.execute(text(f"DROP INDEX IF EXISTS {ix['name']}"))
    User.__table__.create(conn)
    conn.execute(text(f"INSERT INTO users ({names}) SELECT {names} FROM users_v2"))
    conn.execute(text("DROP TABLE users_v2"))
    conn.execute(text("PRAGMA legacy_alter_table=OFF"))


COLUMNS[4] = [
    ("waste_streams", "availability_updated_at", "VARCHAR(40)"),
    ("waste_streams", "min_order_tonnes", "FLOAT"),
    ("waste_streams", "delivery_window", "VARCHAR(120)"),
    ("evidence", "issuer", "VARCHAR(160)"),
    ("evidence", "issue_date", "VARCHAR(20)"),
    ("evidence", "expiry_date", "VARCHAR(20)"),
    ("evidence", "batch_code", "VARCHAR(60)"),
    ("evidence", "test_method", "VARCHAR(120)"),
    ("inquiries", "responsibilities", "JSON DEFAULT '{}'"),
    ("inquiries", "acceptance_criteria", "JSON DEFAULT '{}'"),
    ("inquiries", "used_tonnes", "FLOAT"),
    ("inquiries", "impact_verified_by", "VARCHAR(120)"),
    ("inquiries", "impact_verified_at", "VARCHAR(40)"),
    ("inquiries", "facilitation_requested", "BOOLEAN DEFAULT 0"),
]

COLUMNS[5] = [("evidence", "extraction_method", "VARCHAR(30)")]  # v5 also adds processors, emission_factors, material_images (create_all)

COLUMNS[6] = [("users", "email_alerts", "BOOLEAN DEFAULT 1")]  # v6 also adds notifications (create_all)

STEPS = {3: _users_nullable_industry}
LATEST = max(max(COLUMNS), max(STEPS))


def _version(conn) -> int:
    conn.execute(text("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"))
    row = conn.execute(text("SELECT MAX(version) FROM schema_version")).scalar()
    return int(row or 0)


def migrate(engine: Engine, fresh: bool) -> int:
    """Bring the DB to LATEST. `fresh` = tables were just created by create_all."""
    with engine.begin() as conn:
        current = _version(conn)
        if fresh and current == 0:
            conn.execute(text("INSERT INTO schema_version (version) VALUES (:v)"), {"v": LATEST})
            return LATEST
        if current == 0:
            current = 1  # pre-migration databases are schema v1
        insp = inspect(conn)
        for v in range(current + 1, LATEST + 1):
            for table, col, ddl in COLUMNS.get(v, []):
                if col not in {c["name"] for c in insp.get_columns(table)}:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
            if v in STEPS:
                STEPS[v](conn)
            conn.execute(text("INSERT INTO schema_version (version) VALUES (:v)"), {"v": v})
            log.info("Migrated schema to v%d", v)
            insp = inspect(conn)
    return LATEST


def backfill(db: Session) -> None:
    """Data defaults for rows created before v2 (idempotent)."""
    from .models import Inquiry, WasteStream

    for s in db.query(WasteStream).filter(WasteStream.verification_status.is_(None)).all():
        s.verification_status = "user_declared" if s.source == "declared" else "ai_inferred"
    for s in db.query(WasteStream).all():
        if s.source == "declared" and s.verification_status == "ai_inferred":
            s.verification_status = "user_declared"
        if not s.property_sources:
            s.property_sources = {k: "ai_inferred" for k in (s.composition or {})}
    for q in db.query(Inquiry).all():
        if not q.stages:
            from .engines.exchange import DEFAULT_STAGES
            q.stages = list(DEFAULT_STAGES)
        if q.status == "accepted" and q.stage == "interest":
            q.stage = q.stages[q.stages.index("interest") + 1]
            q.supplier_consent = q.buyer_consent = True
    db.commit()

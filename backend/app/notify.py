"""Notifications: in-app alerts (the bell) plus optional email.

Every alert is stored per user. Email goes through SMTP when SMTP_HOST is set; otherwise the message is written
to backend/outbox/ as an .eml file so the flow can be demonstrated without sending real mail.
Alert text never contains company names, so confidential identities are not leaked through notifications.
"""
import logging
import secrets
import smtplib
import threading
from email.message import EmailMessage

from sqlalchemy.orm import Session

from . import config
from .auth import now_iso
from .models import Notification, User

log = logging.getLogger("sylithex.notify")


def _recipients(db: Session, industry_ids=(), facilitators=False, exclude_user: int | None = None) -> list[User]:
    ids = [i for i in set(industry_ids) if i]
    users = db.query(User).filter(User.industry_id.in_(ids)).all() if ids else []
    if facilitators:
        users += db.query(User).filter(User.role == "facilitator").all()
    seen, out = set(), []
    for u in users:
        if u.id not in seen and u.id != exclude_user:
            seen.add(u.id)
            out.append(u)
    return out


def _email_body(u: User, title: str, body: str | None, link: str | None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = f"Sylithex: {title}"
    msg["From"] = config.SMTP_FROM
    msg["To"] = u.email
    lines = [f"Hello {u.contact_name},", "", title]
    if body:
        lines += ["", body]
    if link:
        lines += ["", f"Open in Sylithex: {config.APP_URL}{link}"]
    lines += ["", "You receive this because email alerts are on for your Sylithex account. Turn them off from the bell menu."]
    msg.set_content("\n".join(lines))
    return msg


def deliver(msgs: list[EmailMessage]) -> str:
    """Send (SMTP) or write to the outbox. Returns 'sent', 'logged' or 'failed'."""
    if not msgs:
        return "off"
    if not config.SMTP_HOST:
        config.OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
        for m in msgs:
            (config.OUTBOX_DIR / f"{now_iso().replace(':', '')}-{secrets.token_hex(3)}.eml").write_bytes(bytes(m))
        return "logged"
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as s:
            s.starttls()
            if config.SMTP_USER:
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
            for m in msgs:
                s.send_message(m)
        return "sent"
    except Exception as e:  # never break the user's action because mail failed
        log.warning("Email delivery failed: %s", e)
        return "failed"


def notify(db: Session, *, kind: str, title: str, body: str | None = None, link: str | None = None,
           industry_ids=(), facilitators: bool = False, exclude_user: int | None = None, email: bool = True) -> int:
    """Create alerts for every user of the given plants (and facilitators). Caller commits."""
    users = _recipients(db, industry_ids, facilitators, exclude_user)
    msgs = []
    for u in users:
        mail = email and bool(u.email_alerts)
        db.add(Notification(user_id=u.id, kind=kind, title=title[:200], body=(body or None) and body[:1000], link=link,
                            emailed="queued" if mail else "off", created_at=now_iso()))
        if mail:
            msgs.append(_email_body(u, title, body, link))
    if msgs:
        # SMTP can be slow; never make the user's click wait for it.
        threading.Thread(target=deliver, args=(msgs,), daemon=True).start()
    return len(users)


def out(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "read": n.read_at is not None,
            "created_at": n.created_at, "emailed": n.emailed}


def seed_notifications(db: Session) -> None:
    """Demo only: give each seeded exchange's waiting party a starting alert (no emails)."""
    from .models import ExchangeEvent, Inquiry
    if db.query(Notification).count():
        return
    for q in db.query(Inquiry).all():
        last = db.query(ExchangeEvent).filter_by(inquiry_id=q.id).order_by(ExchangeEvent.id.desc()).first()
        if not last or not last.text:
            continue
        m = q.match
        target = [i for i in (q.from_industry_id, q.to_industry_id) if i != last.actor_industry_id] or [q.to_industry_id]
        notify(db, kind="exchange", title=f"Exchange #{q.id} · {m.waste_stream.waste_name} → {m.demand.material}", body=last.text,
               link=f"/exchange/{q.id}", industry_ids=target, email=False)
    db.commit()

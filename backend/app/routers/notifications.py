from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import config
from ..auth import current_user, now_iso
from ..database import get_db
from ..models import Notification, User
from ..notify import out

router = APIRouter(tags=["notifications"])


@router.get("/notifications")
def mine(limit: int = 30, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    rows = q.order_by(Notification.id.desc()).limit(max(1, min(limit, 100))).all()
    return {"items": [out(n) for n in rows], "unread": q.filter(Notification.read_at.is_(None)).count(),
            "email_alerts": bool(user.email_alerts), "email_mode": "smtp" if config.SMTP_HOST else "outbox"}


class ReadBody(BaseModel):
    ids: list[int] | None = Field(None, max_length=500)  # omit to mark everything read


@router.post("/notifications/read")
def mark_read(body: ReadBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None))
    if body.ids is not None:
        q = q.filter(Notification.id.in_(body.ids))
    n = q.update({Notification.read_at: now_iso()}, synchronize_session=False)
    db.commit()
    return {"marked": n}


class PrefBody(BaseModel):
    email_alerts: bool


@router.patch("/notifications/preferences")
def prefs(body: PrefBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.email_alerts = body.email_alerts
    db.commit()
    return {"email_alerts": user.email_alerts}

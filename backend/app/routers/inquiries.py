"""Backwards-compatible deal-request API. An inquiry is the INTEREST stage of an exchange (see exchanges.py)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_user
from ..database import get_db
from ..models import Inquiry, User
from .exchanges import ActionBody, ExchangeCreate, alert_exchange, apply_action, create_exchange, exchange_out, list_mine as list_exchanges

router = APIRouter(prefix="/inquiries", tags=["inquiries"])


class InquiryUpdate(BaseModel):
    status: str
    reply: str | None = Field(None, max_length=2000)


@router.post("")
def create(body: ExchangeCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return exchange_out(db, create_exchange(db, user, body), user.industry_id)


@router.get("")
def list_mine(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return list_exchanges(user, db)


@router.patch("/{inquiry_id}")
def respond(inquiry_id: int, body: InquiryUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.get(Inquiry, inquiry_id)
    if not q or user.industry_id not in (q.from_industry_id, q.to_industry_id):
        raise HTTPException(404, "Request not found")
    if q.to_industry_id != user.industry_id:
        raise HTTPException(403, "Only the receiving company can respond")
    if body.status not in ("accepted", "declined"):
        raise HTTPException(400, "Status must be accepted or declined")
    if q.status != "pending":
        raise HTTPException(409, f"Request already {q.status}")
    apply_action(db, q, user, ActionBody(action="accept" if body.status == "accepted" else "decline", text=body.reply))
    alert_exchange(db, q, user, f"Your request was {body.status}" + (f": {body.reply}" if body.reply else "."))
    db.commit()
    return exchange_out(db, q, user.industry_id)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import config
from ..auth import create_session, current_user, hash_password, verify_password
from ..database import get_db
from ..models import AuthSession, User
from ..schemas import IndustryCreate
from ..services import industry_dict
from .industries import register_industry

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    contact_name: str = Field(min_length=2, max_length=120)
    designation: str | None = None
    phone: str | None = None
    industry: IndustryCreate


class LoginBody(BaseModel):
    email: str
    password: str


def user_out(u: User) -> dict:
    ind = {**industry_dict(u.industry), "visibility": u.industry.visibility} if u.industry else None
    return {"id": u.id, "email": u.email, "contact_name": u.contact_name, "designation": u.designation,
            "phone": u.phone, "is_demo": u.is_demo, "role": u.role, "industry": ind}


class VisibilityBody(BaseModel):
    visibility: str = Field(pattern="^(public|confidential)$")


@router.patch("/me/visibility")
def set_visibility(body: VisibilityBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Confidential: name, exact location and contacts are hidden until both sides of an exchange consent."""
    if not user.industry:
        raise HTTPException(403, "Only company accounts have a public profile")
    user.industry.visibility = body.visibility
    db.commit()
    return user_out(user)


@router.post("/register")
def register(body: RegisterBody, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email")
    if db.query(User).filter_by(email=email).first():
        raise HTTPException(409, "An account with this email already exists")
    ind, n = register_industry(db, body.industry)
    user = User(email=email, password_hash=hash_password(body.password), contact_name=body.contact_name,
                designation=body.designation, phone=body.phone, industry_id=ind.id)
    db.add(user)
    db.commit()
    return {"token": create_session(db, user), "user": user_out(user), "matches_created": n}


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email.strip().lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    return {"token": create_session(db, user), "user": user_out(user)}


@router.post("/logout")
def logout(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(AuthSession).filter_by(user_id=user.id).delete()
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.get("/demo-accounts")
def demo_accounts(db: Session = Depends(get_db)):
    if not config.DEMO_LOGIN:
        return []
    return [{"user_id": u.id, "contact_name": u.contact_name, "designation": u.designation, "role": u.role,
             "industry": {k: v for k, v in industry_dict(u.industry).items() if k in ("id", "name", "type", "cluster")} if u.industry
             else {"id": None, "name": "MIDC Symbiosis Cell (facilitator)", "type": "facilitator", "cluster": "All clusters"}}
            for u in db.query(User).filter_by(is_demo=True).order_by(User.id).all()]


class DemoLoginBody(BaseModel):
    user_id: int


@router.post("/demo-login")
def demo_login(body: DemoLoginBody, db: Session = Depends(get_db)):
    user = db.get(User, body.user_id)
    if not config.DEMO_LOGIN or not user or not user.is_demo:
        raise HTTPException(403, "Demo login is disabled")
    return {"token": create_session(db, user), "user": user_out(user)}

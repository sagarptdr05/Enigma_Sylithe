import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "claude-haiku-4-5-20251001")
USE_EMBEDDINGS = os.getenv("USE_EMBEDDINGS", "1") == "1"
# On Vercel the code is read-only and only /tmp is writable; files there last for the life of one instance.
ON_VERCEL = bool(os.getenv("VERCEL"))
RUNTIME_DIR = Path(os.getenv("RUNTIME_DIR", "/tmp/sylithex" if ON_VERCEL else str(BASE_DIR)))
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
PREBUILT_DIR = BASE_DIR / "prebuilt"  # created by `python -m app.prebuild` during the Vercel build
if (not os.getenv("PREBUILD") and not os.getenv("DATABASE_URL") and (PREBUILT_DIR / "sylithex.db").exists()
        and not (RUNTIME_DIR / "sylithex.db").exists() and RUNTIME_DIR.resolve() != PREBUILT_DIR.resolve()):
    import shutil

    shutil.copytree(PREBUILT_DIR, RUNTIME_DIR, dirs_exist_ok=True)  # new instance: start from the seeded demo data
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{RUNTIME_DIR / 'sylithex.db'}")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(RUNTIME_DIR / "uploads")))
DATA_DIR = Path(__file__).resolve().parent / "data"
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
# One-click demo logins for hackathon judging (disable in production)
DEMO_LOGIN = os.getenv("DEMO_LOGIN", "1") == "1"

# Email alerts. Without SMTP_HOST, emails are written to backend/outbox/ instead of being sent.
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "Sylithex <alerts@sylithex.local>")
APP_URL = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")
OUTBOX_DIR = Path(os.getenv("OUTBOX_DIR", str(RUNTIME_DIR / "outbox")))

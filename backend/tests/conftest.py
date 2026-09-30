import os
from pathlib import Path

# Must run before `app` is imported: isolated DB, no LLM, no model download
TEST_DB = Path(__file__).parent / "test_sylithex.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["USE_EMBEDDINGS"] = "0"
os.environ["DEMO_LOGIN"] = "1"
os.environ["USE_CLIP"] = "0"  # colour/texture descriptor only: fast, deterministic tests
TEST_DB.unlink(missing_ok=True)
OUTBOX = Path(__file__).parent / "test_outbox"
os.environ["OUTBOX_DIR"] = str(OUTBOX)
os.environ["SMTP_HOST"] = ""


def pytest_sessionfinish(session, exitstatus):
    import shutil
    TEST_DB.unlink(missing_ok=True)
    shutil.rmtree(OUTBOX, ignore_errors=True)

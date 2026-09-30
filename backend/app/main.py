import logging
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .data.seed import seed, seed_demo_users, seed_execution
from .engines.routes import seed_processors
from .data.sample_images import seed_images
from .notify import seed_notifications
from .factors import apply_to_scoring, seed_factors
from .database import Base, SessionLocal, engine
from .engines import llm, similarity, vision
from .models import Match, WasteStream
from .migrations import backfill, migrate
from .privacy import privacy_context
from .services import compute_all_matches, load_candidates, populate_all, sync_kb_specs
from sqlalchemy import inspect

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sylithex")
for _noisy in ("httpx", "sentence_transformers", "huggingface_hub"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)


def bootstrap() -> None:
    threading.Thread(target=similarity._load_model, daemon=True).start()  # warm embeddings
    vision.clip_model()  # start loading CLIP for photos in the background (optional)
    fresh = "industries" not in inspect(engine).get_table_names()
    Base.metadata.create_all(engine)
    version = migrate(engine, fresh)
    log.info("Schema version %d (%s)", version, "fresh database" if fresh else "existing database")
    with SessionLocal() as db:
        backfill(db)
        raw = seed(db)
        seed_factors(db)
        apply_to_scoring(db)  # matches, simulator and impact share one transport factor
        if db.query(WasteStream).count() == 0:
            n = populate_all(db, raw)
            log.info("Inferred waste streams for %d industries (LLM: %s)", n, llm.available())
        if sync_kb_specs(db) or db.query(Match).count() == 0:
            log.info("Computed %d viable matches", compute_all_matches(db))
        else:
            load_candidates(db)
        if seed_demo_users(db):
            log.info("Seeded demo company accounts")
        seed_execution(db)
        seed_processors(db)
        seed_images(db)
        seed_notifications(db)


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap()
    yield


app = FastAPI(title="Sylithex API", version="1.0.0", lifespan=lifespan, dependencies=[Depends(privacy_context)])
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


from .routers import (alternatives, auth, clusters, exchanges, graph, industries, inquiries, materials, matches,  # noqa: E402
                      notifications, processors, search, simulate, sourcing, visual)

for r in (auth, notifications, inquiries, exchanges, materials, visual, processors, alternatives, sourcing, clusters, industries, matches, graph, simulate, search):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "llm": llm.available(), "model": config.LLM_MODEL}

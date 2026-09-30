"""Name similarity: sentence-transformers (all-MiniLM-L6-v2) with a difflib fallback."""
import difflib
import logging
import threading
from functools import lru_cache

from .. import config

log = logging.getLogger("sylithex.similarity")
_model = None
_model_failed = False
# torch models are not safe to call from several request threads at once (MPS/GPU can deadlock the whole process)
_lock = threading.RLock()

ALIASES = {
    "blast furnace slag": "BF slag", "gbfs": "BF slag", "granulated blast furnace slag": "BF slag",
    "bof slag": "Steel slag", "ld slag": "Steel slag", "eaf slag": "Steel slag", "converter slag": "Steel slag",
    "lime mud": "Lime sludge", "lime kiln mud": "Lime sludge", "vinasse": "Spent wash", "stillage": "Spent wash",
    "distillery effluent": "Spent wash", "filter cake": "Press mud", "pressmud": "Press mud",
    "filter mud": "Press mud", "fermentation co2": "CO2 off-gas", "flue gas": "CO2 off-gas",
    "carbon dioxide": "CO2 off-gas", "co2 emissions": "CO2 off-gas", "pfa": "Fly ash",
    "pulverised fuel ash": "Fly ash", "boiler ash": "Bottom ash", "furnace ash": "Bottom ash",
    "spent sulphuric acid": "Spent acid", "spent pickle liquor": "Spent acid", "waste acid": "Spent acid",
    "low grade heat": "Waste heat", "exhaust heat": "Waste heat", "flue gas heat": "Waste heat",
    "iron scale": "Mill scale", "turnings": "Metal scrap", "swarf": "Metal scrap", "borings": "Metal scrap",
    "used foundry sand": "Foundry sand", "spent foundry sand": "Foundry sand", "kiln dust": "Cement kiln dust",
    "ckd": "Cement kiln dust", "organic waste": "Food waste", "fruit peels": "Food waste",
    "etp sludge": "Chemical gypsum", "gypsum sludge": "Chemical gypsum", "biogas slurry": "Digestate",
}


def _load_model():
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    with _lock:
        return _load_locked()


def _load_locked():
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    if not config.USE_EMBEDDINGS:
        _model_failed = True
        return None
    try:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
        log.info("Loaded sentence-transformers all-MiniLM-L6-v2")
    except Exception as exc:
        log.warning("Embeddings unavailable, using difflib: %s", exc)
        _model_failed = True
    return _model


def backend_name() -> str:
    return "sentence-transformers" if _load_model() is not None else "difflib"


@lru_cache(maxsize=4096)
def _embed(text: str):
    with _lock:
        return _model.encode(text, normalize_embeddings=True, show_progress_bar=False)


def similarity(a: str, b: str) -> float:
    a_n, b_n = a.strip().lower(), b.strip().lower()
    if a_n == b_n:
        return 1.0
    model = _load_model()
    if model is not None:
        return float(_embed(a_n) @ _embed(b_n))
    return difflib.SequenceMatcher(None, a_n, b_n).ratio()


def canonical_name(name: str, vocabulary: list[str], threshold: float = 0.75) -> str:
    """Map a free-text waste name onto the KB vocabulary (exact, alias, then similarity)."""
    low = name.strip().lower()
    for v in vocabulary:
        if v.lower() == low:
            return v
    for alias, target in ALIASES.items():
        if alias in low and target in vocabulary:
            return target
    best, best_s = name, 0.0
    for v in vocabulary:
        s = similarity(name, v)
        if s > best_s:
            best, best_s = v, s
    return best if best_s >= threshold else name.strip()

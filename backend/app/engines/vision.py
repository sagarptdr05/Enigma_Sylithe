"""Image features for material photos.
Always available: a colour + texture descriptor (HSV histogram, brightness, saturation, edge density, grain) and
human-readable traits. Optional: CLIP (sentence-transformers 'clip-ViT-B-32') for image embeddings and zero-shot
material recognition. Visual similarity is indicative only; composition and evidence decide eligibility."""
import io
import logging
import os
import threading

import numpy as np
from PIL import Image, ImageFilter, ImageOps

log = logging.getLogger("sylithex.vision")
_clip = None
_clip_failed = False
_lock = threading.RLock()
SIZE = 256


def load(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((1600, 1600))
    return img


def sanitized_jpeg(img: Image.Image) -> bytes:
    """Re-encode: strips EXIF/GPS metadata that could reveal a confidential site."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def descriptor(img: Image.Image) -> tuple[list[float], dict]:
    small = ImageOps.fit(img, (SIZE, SIZE))
    hsv = np.asarray(small.convert("HSV"), dtype=np.float32) / 255.0
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    hist, _ = np.histogramdd(np.stack([h.ravel(), s.ravel(), v.ravel()], 1), bins=(8, 3, 4), range=((0, 1), (0, 1), (0, 1)))
    hist = hist.ravel() / hist.sum()
    gray = np.asarray(small.convert("L"), dtype=np.float32) / 255.0
    edges = np.asarray(small.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32) / 255.0
    edge_density = float((edges > 0.12).mean())
    blocks = gray.reshape(16, 16, 16, 16).mean(axis=(1, 3))
    coarseness = float(blocks.std())  # large-scale variation: lumps / granules
    fine = float(np.abs(np.diff(gray, axis=1)).mean())  # pixel-level variation: grain
    stats = [float(v.mean()), float(v.std()), float(s.mean()), edge_density, coarseness * 3, fine * 5]
    vec = np.concatenate([np.sqrt(hist), np.array(stats) * 0.8])
    vec = vec / (np.linalg.norm(vec) + 1e-9)
    rgb = np.asarray(small, dtype=np.float32).reshape(-1, 3).mean(0)
    return vec.round(5).tolist(), traits(rgb, float(v.mean()), float(s.mean()), edge_density, coarseness, fine)


def colour_name(rgb, bright: float, sat: float) -> str:
    r, g, b = rgb
    if sat < 0.12:
        return "white / off-white" if bright > 0.82 else "light grey" if bright > 0.62 else "grey" if bright > 0.38 else "dark grey / black"
    if r >= g >= b and sat < 0.25 and bright > 0.6:
        return "beige / sand"
    if r > g > b and r - b > 40:
        return "brown" if bright < 0.55 else "tan / straw" if g > 0.75 * r else "reddish brown"
    if g >= r and g > b:
        return "greenish"
    if b > r:
        return "bluish grey"
    return "yellowish" if r > 150 and g > 130 else "brownish grey"


def traits(rgb, bright, sat, edge, coarse, fine) -> dict:
    colour = colour_name(rgb, bright, sat)
    clumped = coarse >= 0.025 and edge < 0.15
    if edge < 0.07 and coarse < 0.02:
        texture = "fine powder"
    elif clumped:
        texture = "clumped / pasty"
    elif edge >= 0.15 and colour in ("tan / straw", "brown"):
        texture = "fibrous"
    elif edge >= 0.15 and coarse >= 0.02:
        texture = "lumpy / coarse"
    else:
        texture = "granular / sandy"
    moisture = "damp look" if clumped else "dry look"
    return {"colour": colour, "brightness": round(bright, 2), "texture": texture, "moisture_look": moisture,
            "grain": round(fine, 3), "edge_density": round(edge, 3), "mean_rgb": [int(x) for x in rgb]}


def cosine(a: list[float] | None, b: list[float] | None) -> float | None:
    if not a or not b:
        return None
    x, y = np.asarray(a), np.asarray(b)
    return float(np.dot(x, y) / (np.linalg.norm(x) * np.linalg.norm(y) + 1e-9))


_loading = False


def _load_clip() -> None:
    global _clip, _clip_failed
    try:
        from sentence_transformers import SentenceTransformer
        m = SentenceTransformer("clip-ViT-B-32", device="cpu")
        with _lock:
            _clip = m
        log.info("Loaded CLIP for material photos")
    except Exception as exc:
        log.warning("CLIP unavailable, using colour/texture descriptor only: %s", exc)
        _clip_failed = True


def clip_model():
    """Non-blocking: the first call starts loading CLIP in the background (it may need a one-time ~600 MB
    download). Until it is ready, photos are compared with the colour/texture descriptor."""
    global _loading, _clip_failed
    if _clip is not None or _clip_failed:
        return _clip
    if os.getenv("USE_CLIP", "1") != "1":
        _clip_failed = True
        return None
    with _lock:
        if not _loading:
            _loading = True
            threading.Thread(target=_load_clip, daemon=True).start()
    return None


def clip_embed(img: Image.Image) -> list[float] | None:
    m = clip_model()
    if m is None:
        return None
    with _lock:
        return m.encode([img], normalize_embeddings=True, show_progress_bar=False)[0].round(5).tolist()


_label_cache: dict[tuple, np.ndarray] = {}


def photographable(materials: list[str]) -> list[str]:
    """Gases, heat and effluents can't be identified from a photo: keep solids and sludges only."""
    from . import kb
    cats = {r["waste_name"]: r["category"] for r in kb.waste_kb()}
    return [x for x in materials if cats.get(x) not in ("energy",) and x not in ("CO2 off-gas", "Spent wash", "Spent acid", "Surplus biogas")]


MIN_ZERO_SHOT = 0.5


def zero_shot(embedding: list[float] | None, materials: list[str], top: int = 3) -> list[dict]:
    m = clip_model()
    materials = photographable(materials)
    if m is None or not embedding:
        return []
    key = tuple(materials)
    if key not in _label_cache:
        with _lock:
            _label_cache[key] = m.encode([f"a close-up photo of {x.lower()}, an industrial by-product" for x in materials],
                                         normalize_embeddings=True, show_progress_bar=False)
    sims = _label_cache[key] @ np.asarray(embedding)
    p = np.exp(sims * 100) / np.exp(sims * 100).sum()
    idx = np.argsort(-p)[:top]
    out = [{"material": materials[i], "score": round(float(p[i]), 3), "method": "clip_zero_shot"} for i in idx]
    return out if out and out[0]["score"] >= MIN_ZERO_SHOT else []  # too uncertain: let nearest labelled photos decide


def similarity(a, b) -> dict:
    """a, b: objects/dicts with .features and .embedding. Returns overall 0-1 and its parts."""
    fa, fb = _get(a, "features"), _get(b, "features")
    desc = cosine(fa, fb)
    desc = max(0.0, min(1.0, (desc - 0.2) / 0.8)) if desc is not None else None  # map cosine to a readable 0-1
    clip = cosine(_get(a, "embedding"), _get(b, "embedding"))
    clip = max(0.0, min(1.0, (clip - 0.6) / 0.4)) if clip is not None else None
    overall = (0.4 * clip + 0.6 * desc) if clip is not None and desc is not None else desc  # CLIP is weak on colour; the descriptor is not
    return {"overall": round(overall or 0.0, 3), "descriptor": None if desc is None else round(desc, 3), "clip": None if clip is None else round(clip, 3),
            "method": "CLIP + colour/texture" if clip is not None else "colour/texture descriptor"}


def _get(o, k):
    return o.get(k) if isinstance(o, dict) else getattr(o, k, None)


def compare_traits(a: dict, b: dict) -> list[dict]:
    rows = []
    for k, label in (("colour", "Colour"), ("texture", "Texture"), ("moisture_look", "Moisture look")):
        rows.append({"trait": label, "yours": a.get(k), "theirs": b.get(k), "same": a.get(k) == b.get(k)})
    rows.append({"trait": "Brightness", "yours": a.get("brightness"), "theirs": b.get("brightness"),
                 "same": abs((a.get("brightness") or 0) - (b.get("brightness") or 0)) < 0.12})
    return rows


def ensure_embeddings(db) -> None:
    """When CLIP is available, backfill embeddings for photos stored before it was loaded (e.g. seeded samples)."""
    if clip_model() is None:
        return
    from ..models import MaterialImage
    from ..routers.materials import IMAGE_DIR
    from . import kb
    changed = False
    for im in db.query(MaterialImage).filter(MaterialImage.embedding.is_(None)).all():
        try:
            img = Image.open(IMAGE_DIR / im.stored_name).convert("RGB")
        except Exception:
            continue
        im.embedding = clip_embed(img)
        im.predicted = zero_shot(im.embedding, kb.waste_vocabulary())
        changed = True
    if changed:
        db.commit()

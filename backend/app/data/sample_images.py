"""Procedurally generated sample photos for the demo (always labelled 'synthetic' in the UI).
Each material gets a plausible colour and texture so photo matching can be demonstrated without real photos."""
import io
import secrets

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy.orm import Session

STYLES = {
    # name: (base RGB, noise, clumps, granules, fibres, rocks)
    "gypsum": ((236, 232, 222), 6, 0.10, 0, 0, 0),
    "phosphogypsum": ((222, 215, 196), 9, 0.35, 0, 0, 0),
    "chemical_gypsum": ((214, 204, 180), 10, 0.45, 0, 0, 0),
    "fly_ash": ((150, 150, 148), 7, 0.08, 0, 0, 0),
    "bf_slag": ((196, 186, 160), 14, 0.0, 2600, 0, 0),
    "steel_slag": ((78, 76, 74), 18, 0.2, 0, 0, 90),
    "bagasse": ((201, 176, 120), 12, 0.1, 0, 900, 0),
    "lime_sludge": ((190, 192, 186), 8, 0.55, 0, 0, 0),
}


def make(style: str, seed: int, size: int = 512) -> Image.Image:
    base, noise, clumps, granules, fibres, rocks = STYLES[style]
    rnd = np.random.default_rng(seed)
    arr = np.ones((size, size, 3)) * np.array(base, dtype=float)
    arr += rnd.normal(0, noise, (size, size, 1))
    if clumps:
        low = rnd.normal(0, 1, (size // 32, size // 32))
        low = np.asarray(Image.fromarray(((low - low.min()) / (np.ptp(low) + 1e-9) * 255).astype("uint8")).resize((size, size), Image.BICUBIC), dtype=float) / 255
        arr *= (1 - clumps * 0.35) + clumps * 0.35 * low[..., None] * 2
    img = Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))
    d = ImageDraw.Draw(img)
    for _ in range(granules):
        x, y, r = rnd.integers(0, size), rnd.integers(0, size), rnd.integers(2, 6)
        shade = int(rnd.integers(-45, 35))
        c = tuple(int(np.clip(v + shade, 0, 255)) for v in base)
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    for _ in range(fibres):
        x, y = rnd.integers(0, size), rnd.integers(0, size)
        ang, ln = rnd.uniform(0, np.pi), rnd.integers(15, 60)
        shade = int(rnd.integers(-50, 30))
        c = tuple(int(np.clip(v + shade, 0, 255)) for v in base)
        d.line([x, y, x + ln * np.cos(ang), y + ln * np.sin(ang)], fill=c, width=int(rnd.integers(1, 3)))
    for _ in range(rocks):
        x, y, r = rnd.integers(0, size), rnd.integers(0, size), rnd.integers(10, 34)
        shade = int(rnd.integers(-30, 40))
        c = tuple(int(np.clip(v + shade, 0, 255)) for v in base)
        pts = [(x + r * np.cos(t) * rnd.uniform(0.6, 1.1), y + r * np.sin(t) * rnd.uniform(0.6, 1.1)) for t in np.linspace(0, 2 * np.pi, 8)]
        d.polygon(pts, fill=c, outline=tuple(max(0, v - 40) for v in c))
    return img.filter(ImageFilter.GaussianBlur(0.6))


SEED_SUPPLY = [("Deccan Phosphates & Fertilizers Ltd", "Phosphogypsum", "phosphogypsum"), ("Krishi Rasayan Fertilizers Pvt Ltd", "Phosphogypsum", "phosphogypsum"),
               ("Kalash Pharma Chem Pvt Ltd", "Chemical gypsum", "chemical_gypsum"), ("Taloja Captive Power Co. Ltd", "Fly ash", "fly_ash"),
               ("Konkan Ispat Steel Ltd", "BF slag", "bf_slag"), ("Konkan Ispat Steel Ltd", "Steel slag", "steel_slag"),
               ("Shri Panchganga Sahakari Sakhar Karkhana Ltd", "Bagasse", "bagasse"), ("Kolhapur Agro Papers Ltd", "Lime sludge", "lime_sludge")]
SEED_REQUIREMENT = [("Raigad Cement Works Ltd", "Mineral gypsum", "gypsum")]


def seed_images(db: Session) -> int:
    from ..auth import now_iso
    from ..engines import vision
    from ..models import Demand, Industry, MaterialImage, WasteStream
    from ..routers.materials import IMAGE_DIR

    if db.query(MaterialImage).count():
        return 0
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    by_name = {i.name: i for i in db.query(Industry).all()}
    n = 0

    def store(style, i):
        img = make(style, seed=1000 + i)
        stored = secrets.token_hex(16) + ".jpg"
        (IMAGE_DIR / stored).write_bytes(vision.sanitized_jpeg(img))
        feats, traits = vision.descriptor(img)
        return stored, img.size, feats, traits

    for i, (company, waste, style) in enumerate(SEED_SUPPLY):
        ind = by_name.get(company)
        s = ind and db.query(WasteStream).filter_by(industry_id=ind.id, waste_name=waste).first()
        if s:
            stored, (w, h), feats, traits = store(style, i)
            db.add(MaterialImage(role="supply", waste_stream_id=s.id, owner_industry_id=ind.id, stored_name=stored, content_type="image/jpeg",
                                 width=w, height=h, caption=f"Sample photo of {waste.lower()} (synthetic)", features=feats, traits=traits,
                                 predicted=[], synthetic=True, created_at=now_iso()))
            n += 1
    for i, (company, material, style) in enumerate(SEED_REQUIREMENT):
        ind = by_name.get(company)
        d = ind and db.query(Demand).filter_by(industry_id=ind.id, material=material).first()
        if d:
            stored, (w, h), feats, traits = store(style, 50 + i)
            db.add(MaterialImage(role="requirement", demand_id=d.id, owner_industry_id=ind.id, stored_name=stored, content_type="image/jpeg",
                                 width=w, height=h, caption="Reference photo of the natural gypsum we use today (synthetic)", features=feats,
                                 traits=traits, predicted=[], synthetic=True, created_at=now_iso()))
            n += 1
    db.commit()
    return n

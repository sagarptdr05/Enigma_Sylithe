"""Vercel build step: create the seeded demo database once, at build time.

Seeding (AI inference for 80 plants + all matches) takes ~40 s, too slow for every cold start.
The result is written to backend/prebuilt/ and shipped with the function; at start-up config.py copies it
into the writable /tmp runtime folder, so an instance is ready in under a second.
Run: python -m app.prebuild
"""
import os
import shutil
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "prebuilt"


def main() -> None:
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    os.environ["RUNTIME_DIR"] = str(OUT)
    os.environ.pop("DATABASE_URL", None)
    os.environ["PREBUILD"] = "1"
    t = time.time()
    from .main import bootstrap  # imported after the env is set: config reads it at import time

    bootstrap()
    print(f"Prebuilt demo database in {time.time() - t:.1f}s -> {OUT}")


if __name__ == "__main__":
    main()

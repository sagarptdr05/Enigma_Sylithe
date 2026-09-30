#!/usr/bin/env bash
# One-command local dev: sets up (first run only) and starts backend :8000 + frontend :5173
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3.11}"
command -v "$PY" >/dev/null || PY=python3

cd "$ROOT/backend"
if [ ! -d .venv ]; then
  "$PY" -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements-dev.txt
fi
[ -f .env ] || cp .env.example .env
if [ "$1" = "--reset" ]; then rm -f sylithex.db; echo "Database reset"; fi

cd "$ROOT/frontend"
[ -d node_modules ] || npm install

cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --port 8000 &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT
cd "$ROOT/frontend" && npm run dev

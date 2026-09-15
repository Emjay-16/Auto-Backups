#!/bin/sh
set -eu

if [ "${RUN_ALEMBIC_MIGRATIONS:-true}" = "true" ] && [ -f /app/alembic.ini ] && [ -d /app/alembic ]; then
  alembic upgrade head
fi

exec uvicorn api.main:app --host 0.0.0.0 --port 8000

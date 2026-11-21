#!/bin/sh
# Container entrypoint: bring the schema up to date, then serve.
# Set WYSEBEE_MIGRATE_ON_START=false to run `alembic upgrade head` as a separate
# release step instead.
set -e

if [ "${WYSEBEE_MIGRATE_ON_START:-true}" = "true" ]; then
    alembic upgrade head
    # Then each extension's own tables (WYSEBEE_EXTENSIONS; apps/cloud/extensions.py).
    python -m apps.cloud.extensions migrate
fi

exec uvicorn apps.cloud.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-${WYSEBEE_PORT:-8000}}" \
    --proxy-headers --forwarded-allow-ips='*'

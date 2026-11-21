# syntax=docker/dockerfile:1

# ---- Stage 1: build the pages (the landing page, and the web app at /app/) -----------
# Runs on the build machine's own platform: its output is static files, the same on
# every architecture. Building it under emulation (an amd64 image for Azure, built on
# an Apple-silicon Mac) crashes esbuild with "fatal error: lfstack.push".
FROM --platform=$BUILDPLATFORM node:22-alpine AS ui
WORKDIR /src/ui
COPY ui/package.json ui/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY ui/ ./
# vite writes to ../apps/cloud/dist (the landing page) and ../apps/cloud/dist/app
RUN mkdir -p /src/apps/cloud && yarn build

# ---- Stage 2: Python runtime ------------------------------------------------
FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY migrations/ ./migrations/
COPY scripts/start.sh ./scripts/start.sh
COPY apps/ ./apps/
COPY --from=ui /src/apps/cloud/dist ./apps/cloud/dist

# Assets go to /data/assets, skills' files to
# /data/user-skills, browser recordings to /data/browser-recordings, workspaces' folders to /data/user-workspaces and, for local mock sign-in,
# its key to /data/mock-auth (set in compose): a named volume mounted there takes the folder's owner,
# so the app can write to it.
RUN useradd --create-home --uid 1000 wysebee \
    && mkdir -p /data/assets /data/user-skills /data/user-workspaces /data/browser-recordings /data/mock-auth \
    && chown wysebee:wysebee /data/assets /data/user-skills /data/user-workspaces \
        /data/browser-recordings /data/mock-auth
USER wysebee

ENV WYSEBEE_PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\") or os.environ.get(\"WYSEBEE_PORT\",\"8000\")}/api/health')"

# Runs migrations, then uvicorn on $PORT (if the platform injects one) or $WYSEBEE_PORT.
CMD ["./scripts/start.sh"]

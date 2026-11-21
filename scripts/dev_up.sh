#!/usr/bin/env bash
# Start the local stack — PostgreSQL and the web app — with docker compose. Sign-in is
# Auth0, hosted (WYSEBEE_AUTH_* in .env), or the local mock (WYSEBEE_AUTH_MOCK=true).
#
#   ./scripts/dev_up.sh             # build, start in the background, wait until healthy
#   ./scripts/dev_up.sh --ngrok     # ...then run the ngrok tunnel (scripts/ngrok.sh)
#   ./scripts/dev_up.sh --logs      # ...then follow the web app's logs
#   ./scripts/dev_up.sh --down      # stop everything (data is kept in the volumes)
#
# Not to be confused with scripts/start.sh, the container's own entrypoint.
# Settings come from .env (copied from .env.example the first time).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say() { echo "[dev] $*"; }
die() { echo "error: $*" >&2; exit 1; }

NGROK=0
LOGS=0
for arg in "$@"; do
    case "$arg" in
        --ngrok) NGROK=1 ;;
        --logs) LOGS=1 ;;
        --down) docker compose down; exit 0 ;;
        -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown option: $arg (see --help)" ;;
    esac
done

command -v docker >/dev/null 2>&1 || die "Docker is not installed."
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop, then try again."

if [ ! -f .env ]; then
    cp .env.example .env
    say "created .env from .env.example"
fi

say "building and starting (this waits until every service is healthy)"
docker compose up -d --build --wait --remove-orphans

# Read one variable from .env without running the file.
from_env_file() {
    sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
WEB_PORT="${WEB_PORT:-$(from_env_file WEB_PORT)}"
AUTH_ISSUER="${WYSEBEE_AUTH_ISSUER:-$(from_env_file WYSEBEE_AUTH_ISSUER)}"
AUTH_MOCK="${WYSEBEE_AUTH_MOCK:-$(from_env_file WYSEBEE_AUTH_MOCK)}"
if [ "$AUTH_MOCK" = "true" ] && [ -z "$AUTH_ISSUER" ]; then
    AUTH_ISSUER="http://localhost:${WEB_PORT:-8000}/mock-auth/ (mock: no Auth0 account)"
fi

echo
say "up:"
echo "  web app    http://localhost:${WEB_PORT:-8000}   (your agents: /app/)"
echo "  sign-in    ${AUTH_ISSUER:-off — set WYSEBEE_AUTH_* in .env (see .env.example)}"
echo "  logs       docker compose logs -f web"
echo "  stop       ./scripts/dev_up.sh --down"

if [ "$NGROK" = "1" ]; then
    echo
    exec ./scripts/ngrok.sh
fi
if [ "$LOGS" = "1" ]; then
    exec docker compose logs -f web
fi

#!/usr/bin/env bash
# Expose the local wysebee-cloud through ngrok, at the public URL it is configured for:
#
#   ./scripts/ngrok.sh               # ngrok http 8000 --url $CLOUD_PUBLIC_URL
#   ./scripts/ngrok.sh --coverage    # ...to the UI's coverage mode on 5174 instead
#   ./scripts/ngrok.sh --port 5173   # ...to any port
#
# The URL comes from CLOUD_PUBLIC_URL — in the environment, or else in .env (git-ignored,
# so the domain stays out of the repository), e.g. https://<your-tunnel>.ngrok.dev. The port
# is --port, else WEB_PORT (environment or .env), else 8000. --coverage is the port of
# `yarn dev:app:coverage` (ui/scripts/vite-coverage.ts), which serves /app/ and forwards the
# rest to :8000 — scripts/coverage_session.sh starts all of it. Sign-in needs no tunnel:
# Auth0 is hosted. Its applications must list this URL's callbacks (README, "Sign-in
# (Auth0)"). Other arguments go to ngrok.
#
# Needs: ngrok v3, signed in once (`ngrok config add-authtoken <token>`), with the domain
# reserved in that account.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read one variable from .env without running the file.
from_env_file() {
    [ -f "$REPO_ROOT/.env" ] || return 0
    sed -n "s/^[[:space:]]*$1=//p" "$REPO_ROOT/.env" | tail -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
setting() {
    local value="${!1:-}"
    [ -n "$value" ] || value="$(from_env_file "$1")"
    printf '%s' "${value:-${2:-}}"
}

# The coverage UI's port (ui/package.json, dev:app:coverage; ui/app/vite.config.ts).
COVERAGE_PORT=5174
PORT_ARG=""
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        web) shift ;;  # the old `ngrok.sh web`: the same thing now
        --coverage) PORT_ARG="$COVERAGE_PORT"; shift ;;
        --port)
            [ $# -ge 2 ] || { echo "--port needs a port number." >&2; exit 1; }
            PORT_ARG="$2"; shift 2 ;;
        --port=*) PORT_ARG="${1#--port=}"; shift ;;
        *) break ;;  # the rest goes to ngrok
    esac
done
case "$PORT_ARG" in
    ''|*[!0-9]*) [ -z "$PORT_ARG" ] || { echo "Not a port number: $PORT_ARG" >&2; exit 1; } ;;
esac

if ! command -v ngrok >/dev/null 2>&1; then
    echo "ngrok is not installed: https://ngrok.com/download" >&2
    exit 1
fi

URL="$(setting CLOUD_PUBLIC_URL)"
PORT="${PORT_ARG:-$(setting WEB_PORT 8000)}"
if [ -z "$URL" ]; then
    echo "CLOUD_PUBLIC_URL is not set: add it to .env (see .env.example)." >&2
    exit 1
fi
if ! curl -fsS -o /dev/null --max-time 3 "http://localhost:$PORT/api/health"; then
    echo "warning: nothing answering on localhost:$PORT yet (./scripts/dev_up.sh)." >&2
fi
echo "Tunnelling $URL -> http://localhost:$PORT"
exec ngrok http "$PORT" --url "$URL" "$@"

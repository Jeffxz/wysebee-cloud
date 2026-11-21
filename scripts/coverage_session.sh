#!/usr/bin/env bash
# A UI coverage session in one command: the local stack, the web app in coverage mode, and
# the ngrok tunnel to it — so a browser agent can drive /app/ at the public URL while every
# line it runs is counted (ui/scripts/vite-coverage.ts).
#
#   ./scripts/coverage_session.sh start [--clean]   # start all three (each only if it is not up)
#   ./scripts/coverage_session.sh status            # what is up, and the URL to test
#   ./scripts/coverage_session.sh report            # the coverage so far (ui/coverage-e2e/)
#   ./scripts/coverage_session.sh stop [--all]      # stop the UI and its tunnel; --all: the stack too
#
# start returns once everything answers: the coverage UI and the tunnel run detached (logs and
# pids in data/coverage-session/), so a program tool can run it. --clean forgets the coverage
# saved before. A tunnel already open on CLOUD_PUBLIC_URL (to :8000) is closed first, since one
# URL takes one tunnel; stop opens it again to :8000 if it was there.
#
# Then, in the browser at <URL>/app/, per scenario: set
# localStorage["wysebee-coverage-scenario"], reload, run it, `await window.__saveCoverage__()`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
RUN_DIR="$REPO_ROOT/data/coverage-session"
UI_PORT=5174
WEB_PORT_DEFAULT=8000

say() { echo "[coverage] $*"; }
die() { echo "error: $*" >&2; exit 1; }

# A program run by Wysebee Agent (or launchd) gets a bare PATH: find node, yarn, docker and
# ngrok where they are usually installed.
for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" /Applications/Docker.app/Contents/Resources/bin; do
    [ -d "$dir" ] && case ":$PATH:" in *":$dir:"*) ;; *) PATH="$dir:$PATH" ;; esac
done
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n 1)"
    [ -n "$NODE_BIN" ] && PATH="$NODE_BIN:$PATH"
fi
export PATH

from_env_file() {
    [ -f .env ] || return 0
    sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
WEB_PORT="${WEB_PORT:-$(from_env_file WEB_PORT)}"
WEB_PORT="${WEB_PORT:-$WEB_PORT_DEFAULT}"
PUBLIC_URL="${CLOUD_PUBLIC_URL:-$(from_env_file CLOUD_PUBLIC_URL)}"

answers() { curl -fsS -o /dev/null --max-time 3 "$1" 2>/dev/null; }

# Wait up to $2 seconds for $1 to answer.
wait_for() {
    local url="$1" seconds="$2" i=0
    while [ "$i" -lt "$seconds" ]; do
        answers "$url" && return 0
        sleep 1
        i=$((i + 1))
    done
    return 1
}

# The tunnel ngrok has open on the public URL, as "<public url> <local address>", or nothing.
tunnel() {
    curl -fsS --max-time 3 http://localhost:4040/api/tunnels 2>/dev/null |
        node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const t of JSON.parse(s).tunnels)console.log(t.public_url+" "+t.config.addr)}catch{}})' |
        head -n 1
}

# Run a command in its own session, detached from this one, its output to a log; its pid
# (= its process group) to a pid file.
detach() {
    local name="$1"; shift
    nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- "$@" >"$RUN_DIR/$name.log" 2>&1 &
    echo $! >"$RUN_DIR/$name.pid"
}

# Stop what a pid file names (its whole process group), if it still runs.
stop_pid() {
    local file="$RUN_DIR/$1.pid"
    [ -f "$file" ] || return 0
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
        kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
        kill -KILL -- "-$pid" 2>/dev/null || true
    fi
    rm -f "$file"
}

# Close every ngrok tunnel on the public URL that this script did not open.
close_other_tunnels() {
    local pids
    pids="$(pgrep -f "ngrok http .*--url $PUBLIC_URL" || true)"
    [ -n "$pids" ] || return 0
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5; do pgrep -f "ngrok http .*--url $PUBLIC_URL" >/dev/null || return 0; sleep 1; done
}

status() {
    local stack ui tun
    answers "http://localhost:$WEB_PORT/api/health" && stack="up" || stack="down"
    if answers "http://localhost:$UI_PORT/app/" && curl -fsS --max-time 3 "http://localhost:$UI_PORT/app/src/main.tsx" 2>/dev/null | grep -q __coverage__; then
        ui="up, counting coverage"
    elif answers "http://localhost:$UI_PORT/app/"; then
        ui="up, but NOT in coverage mode"
    else
        ui="down"
    fi
    tun="$(tunnel)"
    echo "  stack (API)    :$WEB_PORT  $stack"
    echo "  coverage UI    :$UI_PORT  $ui"
    echo "  tunnel         ${tun:-down}"
    case "$tun" in
        *":$UI_PORT") echo "  test at        ${tun%% *}/app/" ;;
    esac
    local saved
    saved="$(find ui/.nyc_output -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
    echo "  saved          $saved page load(s) in ui/.nyc_output"
}

start() {
    local clean=0
    for arg in "$@"; do
        case "$arg" in
            "") ;;  # an empty blank from a program tool
            --clean) clean=1 ;;
            *) die "unknown option for start: $arg" ;;
        esac
    done
    [ -n "$PUBLIC_URL" ] || die "CLOUD_PUBLIC_URL is not set: add it to .env (see .env.example)."
    command -v ngrok >/dev/null 2>&1 || die "ngrok is not installed: https://ngrok.com/download"
    command -v yarn >/dev/null 2>&1 || die "yarn is not on PATH (looked in nvm and Homebrew too)."
    mkdir -p "$RUN_DIR"

    # 1. The stack.
    if answers "http://localhost:$WEB_PORT/api/health"; then
        say "stack: already up on :$WEB_PORT"
    else
        say "stack: starting (./scripts/dev_up.sh)"
        ./scripts/dev_up.sh >"$RUN_DIR/stack.log" 2>&1 || die "the stack did not start: see $RUN_DIR/stack.log"
    fi

    # 2. The UI in coverage mode.
    [ -d ui/node_modules ] || (cd ui && yarn install --frozen-lockfile) >"$RUN_DIR/install.log" 2>&1 ||
        die "yarn install failed: see $RUN_DIR/install.log"
    if [ "$clean" = 1 ]; then
        (cd ui && yarn -s coverage:clean)
    fi
    if answers "http://localhost:$UI_PORT/app/"; then
        curl -fsS --max-time 3 "http://localhost:$UI_PORT/app/src/main.tsx" | grep -q __coverage__ ||
            die "something else answers on :$UI_PORT, not in coverage mode: stop it first."
        say "coverage UI: already up on :$UI_PORT"
    else
        say "coverage UI: starting on :$UI_PORT"
        detach ui sh -c "cd '$REPO_ROOT/ui' && exec yarn dev:app:coverage --strictPort"
        wait_for "http://localhost:$UI_PORT/app/" 60 || die "the coverage UI did not start: see $RUN_DIR/ui.log"
    fi

    # 3. The tunnel to it.
    local tun
    tun="$(tunnel)"
    case "$tun" in
        *":$UI_PORT")
            say "tunnel: already open to :$UI_PORT" ;;
        *)
            if [ -n "$tun" ]; then
                say "tunnel: closing the one open to ${tun##* } (stop opens it again)"
                echo "${tun##* }" >"$RUN_DIR/previous-tunnel"
                close_other_tunnels
            fi
            say "tunnel: opening $PUBLIC_URL -> :$UI_PORT"
            detach tunnel ./scripts/ngrok.sh --coverage --log stdout
            local i=0
            until case "$(tunnel)" in *":$UI_PORT") true ;; *) false ;; esac; do
                i=$((i + 1))
                [ "$i" -lt 30 ] || die "the tunnel did not open: see $RUN_DIR/tunnel.log"
                sleep 1
            done ;;
    esac

    echo
    say "ready:"
    status
}

stop() {
    local all=0
    for arg in "$@"; do
        case "$arg" in
            "") ;;  # an empty blank from a program tool
            --all) all=1 ;;
            *) die "unknown option for stop: $arg" ;;
        esac
    done
    mkdir -p "$RUN_DIR"
    stop_pid tunnel
    stop_pid ui
    say "stopped the coverage UI and its tunnel"
    if [ "$all" = 1 ]; then
        ./scripts/dev_up.sh --down >"$RUN_DIR/stack.log" 2>&1 && say "stopped the stack"
        rm -f "$RUN_DIR/previous-tunnel"
    elif [ -f "$RUN_DIR/previous-tunnel" ]; then
        local port
        port="$(sed 's/.*://' "$RUN_DIR/previous-tunnel")"
        rm -f "$RUN_DIR/previous-tunnel"
        detach previous-tunnel ./scripts/ngrok.sh --port "$port" --log stdout
        rm -f "$RUN_DIR/previous-tunnel.pid"
        say "opened the tunnel to :$port again"
    fi
    say "the saved coverage stays in ui/.nyc_output: ./scripts/coverage_session.sh report"
}

case "${1:-}" in
    start) shift; start "$@" ;;
    stop) shift; stop "$@" ;;
    status) status ;;
    report) cd ui && exec yarn -s coverage:report ;;
    -h|--help|"") sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) die "unknown command: $1 (start, status, report or stop; see --help)" ;;
esac

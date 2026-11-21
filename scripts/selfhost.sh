#!/usr/bin/env bash
# Run your own Wysebee Cloud (docs/self-hosting.md): the first time, a walk-through that writes
# .env.selfhost, then builds and starts it with Docker Compose and tells you what to do next.
#
#   ./scripts/selfhost.sh            # first time: walk through the setup, then start; after: start
#   ./scripts/selfhost.sh setup      # walk through the settings again (secrets are kept)
#   ./scripts/selfhost.sh start      # start it (building the image from this checkout)
#   ./scripts/selfhost.sh update     # rebuild from this checkout (after a git pull) and restart
#   ./scripts/selfhost.sh stop       # stop it; your data stays
#   ./scripts/selfhost.sh status     # is it running, and where
#   ./scripts/selfhost.sh logs       # follow the server's logs
#   ./scripts/selfhost.sh token      # show the access token (or make one)
#   ./scripts/selfhost.sh help
#
#   --yes    take the suggested answer to every question (no prompts)
#
# Needs Docker with Compose v2. The settings are in .env.selfhost at the top of the checkout
# (SELFHOST_ENV_FILE to use another); keep it private and backed up: it holds the key your agents'
# database passwords are sealed under. It runs as the Docker Compose project "wysebee-selfhost"
# (SELFHOST_PROJECT to run another beside it, e.g. to try a change).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.selfhost.yml"
EXAMPLE="$ROOT/.env.selfhost.example"
ENV_FILE="${SELFHOST_ENV_FILE:-$ROOT/.env.selfhost}"
PROJECT="${SELFHOST_PROJECT:-wysebee-selfhost}"
YES=0
COMMAND=""
for arg in "$@"; do
    case "$arg" in
    --yes | -y) YES=1 ;;
    -h | --help | help) COMMAND="help" ;;
    setup | start | update | stop | status | logs | token)
        [ -z "$COMMAND" ] || { echo "error: one command at a time." >&2; exit 2; }
        COMMAND="$arg"
        ;;
    *) echo "error: unknown argument '$arg' (try: $0 help)" >&2; exit 2 ;;
    esac
done

# --- output -----------------------------------------------------------------------------------
if [ -t 1 ]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
    BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
say() { echo "$*"; }
step() { echo; echo "${BOLD}Step $1 of $2 — $3${RESET}"; }
ok() { echo "  ${GREEN}✓${RESET} $*"; }
note() { echo "  ${DIM}$*${RESET}"; }
warn() { echo "  ${YELLOW}!${RESET} $*"; }
die() { echo "${RED}error:${RESET} $*" >&2; exit 1; }

# ask "question" "default" → the answer (the default with --yes or an empty answer)
ask() {
    local question="$1" default="${2:-}" answer=""
    if [ "$YES" = "1" ] || [ ! -t 0 ]; then
        echo "$default"
        return
    fi
    if [ -n "$default" ]; then
        read -r -p "  $question [$default]: " answer </dev/tty || true
    else
        read -r -p "  $question: " answer </dev/tty || true
    fi
    echo "${answer:-$default}"
}

# yes_no "question" "Y"|"N" → 0 for yes
yes_no() {
    local question="$1" default="$2" answer
    answer="$(ask "$question (y/n)" "$default")"
    case "$answer" in y | Y | yes | Yes | YES) return 0 ;; *) return 1 ;; esac
}

# --- the settings file ----------------------------------------------------------------------
get_var() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

# set_var KEY VALUE: replace the KEY= line, or add one (values may hold / + =, so no sed).
set_var() {
    local key="$1" value="$2" tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '
        BEGIN { done = 0 }
        index($0, k "=") == 1 { print k "=" v; done = 1; next }
        { print }
        END { if (!done) print k "=" v }
    ' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"
    rm -f "$tmp"
}

random_hex() { # 24 random bytes as hex: safe inside a URL
    if command -v openssl >/dev/null; then openssl rand -hex "${1:-24}"; else od -An -tx1 -N"${1:-24}" /dev/urandom | tr -d ' \n'; fi
}

random_base64() { # 32 random bytes, base64 (the key the database passwords are sealed under)
    if command -v openssl >/dev/null; then openssl rand -base64 32; else head -c 32 /dev/urandom | base64 | tr -d '\n'; fi
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# Whether this installation's server is running now (not merely made).
ours_running() { [ -n "$(compose ps -q --status running web 2>/dev/null || true)" ]; }

# Whether an installation of this project already exists (its database's volume).
installed() { docker volume inspect "${PROJECT}_pgdata" >/dev/null 2>&1; }

address() {
    local port bind public
    port="$(get_var WEB_PORT)"; port="${port:-8000}"
    public="$(get_var WYSEBEE_PUBLIC_URL)"
    bind="$(get_var WEB_BIND)"
    if [ -n "$public" ]; then echo "${public%/}"; elif [ "$bind" = "0.0.0.0" ]; then echo "http://$(lan_ip):$port"; else echo "http://localhost:$port"; fi
}

local_address() { local port; port="$(get_var WEB_PORT)"; echo "http://127.0.0.1:${port:-8000}"; }

lan_ip() {
    local ip=""
    if command -v ipconfig >/dev/null; then ip="$(ipconfig getifaddr en0 2>/dev/null || true)"; fi
    if [ -z "$ip" ] && command -v hostname >/dev/null; then ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"; fi
    # (No apostrophe inside ${...:-...}: macOS's bash 3.2 reads it as a quote.)
    [ -n "$ip" ] || ip="<this computer's address>"
    echo "$ip"
}

# --- the steps --------------------------------------------------------------------------------
check_docker() {
    command -v docker >/dev/null || die "Docker is not installed. Install Docker Desktop (or Docker Engine) and run this again."
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing ('docker compose'). Update Docker and run this again."
    docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop (or the Docker service) and run this again."
}

setup() {
    local total=6 first=0
    [ -f "$ENV_FILE" ] || first=1
    say "${BOLD}Wysebee Cloud — self-hosted setup${RESET}"
    say "Your own Wysebee Cloud on this computer: the web app, your agents, skills, workspaces,"
    say "scheduled tasks and Wysebee Assistant for your AI app. No account, no plans, no limits."
    [ "$first" = "1" ] || note "Settings already in $(basename "$ENV_FILE"): press Enter to keep each one."

    step 1 "$total" "Docker"
    check_docker
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "") with Compose is running."
    if [ "$first" = "1" ] && installed; then
        # A new database password could never open the existing database: stop before touching it.
        die "Wysebee Cloud is already installed here (Docker project '$PROJECT'), but $(basename "$ENV_FILE") is missing.
  Put back the settings file you installed it with (it holds its database password and WYSEBEE_AI_KEK),
  or, to start over and lose its data: docker compose -p $PROJECT -f docker-compose.selfhost.yml down -v"
    fi

    step 2 "$total" "The settings file"
    if [ "$first" = "1" ]; then
        cp "$EXAMPLE" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
        ok "Made $(basename "$ENV_FILE") from the example (readable by you alone)."
    else
        ok "Using $(basename "$ENV_FILE")."
    fi
    note "It is git-ignored. Keep it private, and back it up with your data."

    step 3 "$total" "Secrets"
    if [ -z "$(get_var POSTGRES_PASSWORD)" ]; then
        set_var POSTGRES_PASSWORD "$(random_hex 24)"
        ok "Made a database password."
    else
        ok "Keeping the database password."
    fi
    if [ -z "$(get_var WYSEBEE_AI_KEK)" ]; then
        set_var WYSEBEE_AI_KEK "$(random_base64)"
        ok "Made the key your agents' database passwords are sealed under (WYSEBEE_AI_KEK)."
        warn "Back up $(basename "$ENV_FILE"): without this key, saved PostgreSQL/Snowflake passwords cannot be read."
    else
        ok "Keeping WYSEBEE_AI_KEK."
    fi

    step 4 "$total" "About you"
    note "A self-hosted server is one person's: you. This is how the pages show you."
    local name email
    name="$(ask "Your name" "$(get_var WYSEBEE_SELFHOST_USER_NAME | sed 's/^$/Owner/')")"
    email="$(ask "Your email (optional)" "$(get_var WYSEBEE_SELFHOST_USER_EMAIL)")"
    set_var WYSEBEE_SELFHOST_USER_NAME "${name:-Owner}"
    set_var WYSEBEE_SELFHOST_USER_EMAIL "$email"
    ok "You are ${name:-Owner}${email:+ <$email>}."

    step 5 "$total" "Who can reach it"
    say "  1) This computer only — simplest: no token, the port is published on 127.0.0.1."
    say "  2) Other devices on my network too — needed to pair a phone or another computer:"
    say "     a token protects it, and the port is published on your network."
    local reach current_bind
    current_bind="$(get_var WEB_BIND)"
    reach="$(ask "Choose 1 or 2" "$([ "$current_bind" = "0.0.0.0" ] && echo 2 || echo 1)")"
    if [ "$reach" = "2" ]; then
        set_var WEB_BIND "0.0.0.0"
        if [ -z "$(get_var WYSEBEE_SELFHOST_TOKEN)" ]; then
            set_var WYSEBEE_SELFHOST_TOKEN "$(random_hex 32)"
            ok "Made an access token; the web app asks for it once (shown at the end)."
        else
            ok "Keeping the access token."
        fi
        note "Beyond your own network, put HTTPS in front (Caddy, nginx, Cloudflare Tunnel, Tailscale)"
        note "and give its address here; otherwise leave it empty."
        local public
        public="$(ask "Its public HTTPS address (optional)" "$(get_var WYSEBEE_PUBLIC_URL)")"
        set_var WYSEBEE_PUBLIC_URL "$public"
    else
        set_var WEB_BIND "127.0.0.1"
        if [ -n "$(get_var WYSEBEE_SELFHOST_TOKEN)" ]; then
            if yes_no "Keep requiring the access token you have?" "Y"; then
                ok "Keeping the access token."
            else
                set_var WYSEBEE_SELFHOST_TOKEN ""
                ok "No token: anyone on this computer is you."
            fi
        elif yes_no "Protect it with a token anyway?" "N"; then
            set_var WYSEBEE_SELFHOST_TOKEN "$(random_hex 32)"
            ok "Made an access token (shown at the end)."
        else
            ok "No token: anyone on this computer is you. The server warns about it at start."
        fi
    fi

    step 6 "$total" "Port"
    local port suggested
    local current running=0
    current="$(get_var WEB_PORT)"; current="${current:-8000}"
    ours_running && running=1
    suggested="$current"
    # In use by something else (a running server of ours on its own port is fine).
    while port_in_use "$suggested" && ! { [ "$running" = "1" ] && [ "$suggested" = "$current" ]; }; do
        note "Port $suggested is in use (by something else, e.g. a development server)."
        suggested=$((suggested + 1))
    done
    port="$(ask "The port it listens on" "$suggested")"
    [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die "'$port' is not a port number."
    if port_in_use "$port" && ! { [ "$running" = "1" ] && [ "$port" = "$current" ]; }; then
        die "port $port is in use. Run '$0 setup' again and choose another."
    fi
    set_var WEB_PORT "$port"
    ok "It will answer at $(address)."
}

start() {
    check_docker
    [ -f "$ENV_FILE" ] || die "no $(basename "$ENV_FILE") yet: run '$0' (or '$0 setup') first."
    local port
    port="$(get_var WEB_PORT)"; port="${port:-8000}"
    if ! ours_running && port_in_use "$port"; then
        die "port $port is in use by something else. Choose another: $0 setup"
    fi
    say
    say "${BOLD}Building and starting Wysebee Cloud${RESET} ${DIM}(the first build takes a few minutes)${RESET}"
    compose up -d --build
    say
    say "Waiting for it to answer at $(local_address)/api/health …"
    local tries=0
    until curl -fsS "$(local_address)/api/health" >/dev/null 2>&1; do
        tries=$((tries + 1))
        if [ "$tries" -ge 90 ]; then
            warn "It did not answer within 3 minutes. Its last log lines:"
            compose logs --tail 40 web || true
            die "not started. Check the logs above ('$0 logs')."
        fi
        sleep 2
    done
    ok "Wysebee Cloud is running."
    next_steps
}

next_steps() {
    local url token
    url="$(address)"
    token="$(get_var WYSEBEE_SELFHOST_TOKEN)"
    say
    say "${BOLD}What to do next${RESET}"
    say
    say "  1. Open ${BOLD}$url${RESET}"
    if [ -n "$token" ]; then
        say "     It asks for the access token once (this browser keeps it):"
        say "     ${BOLD}$token${RESET}   ${DIM}('$0 token' shows it again)${RESET}"
    else
        say "     No sign-in: you are the owner."
    fi
    say
    say "  2. Connect your AI app to Wysebee Assistant at $url/assistant/mcp — e.g. Claude Code:"
    if [ -n "$token" ]; then
        say "     claude mcp add --transport http wysebee $url/assistant/mcp --header \"Authorization: Bearer $token\""
    else
        say "     claude mcp add --transport http wysebee $url/assistant/mcp"
    fi
    say
    say "  3. Pair your devices: start the agent pointed at this server, then type the code it shows"
    say "     in the web app (Agents):"
    say "       Mac / Windows / Linux:  WYSEBEE_CLOUD_URL=$url"
    say "       Android:                a build made with WYSEBEE_AGENT_ANDROID_LOCAL_CLOUD_URL=$url"
    say "       Browser extension:      not yet — its server is fixed when it is built"
    if [ "$(get_var WEB_BIND)" != "0.0.0.0" ]; then
        note "     (Only devices on this computer can reach it now: '$0 setup', option 2, for others.)"
    fi
    say
    say "  Stop it: $0 stop    Logs: $0 logs    After a git pull: $0 update"
    say "  Back up: $(basename "$ENV_FILE") and the Docker volumes of the '$PROJECT' project."
}

status() {
    check_docker
    if ours_running; then
        ok "Running at $(address)."
        compose ps
    else
        say "Not running. Start it: $0 start"
    fi
}

token() {
    [ -f "$ENV_FILE" ] || die "no $(basename "$ENV_FILE") yet: run '$0' first."
    local t
    t="$(get_var WYSEBEE_SELFHOST_TOKEN)"
    if [ -n "$t" ]; then
        say "$t"
    elif yes_no "No access token is set. Make one now?" "N"; then
        set_var WYSEBEE_SELFHOST_TOKEN "$(random_hex 32)"
        say "$(get_var WYSEBEE_SELFHOST_TOKEN)"
        note "Restart to use it: $0 update"
    else
        say "No access token: anyone who can reach the port is you."
    fi
}

case "${COMMAND:-}" in
help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
setup) setup; if yes_no "Start (or restart) it now?" "Y"; then start; fi ;;
start | update) start ;;
stop) check_docker; compose stop; ok "Stopped. Your data stays; start it again with: $0 start" ;;
status) status ;;
logs) check_docker; compose logs -f web ;;
token) token ;;
"")
    if [ -f "$ENV_FILE" ]; then
        start
    else
        setup
        say
        if yes_no "Everything is set. Build and start it now?" "Y"; then start; else say "Start it later with: $0 start"; fi
    fi
    ;;
esac

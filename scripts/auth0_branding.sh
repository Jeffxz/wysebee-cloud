#!/usr/bin/env bash
# Apply Wysebee's Universal Login branding (auth0/) to an Auth0 tenant.
#
#   AUTH0_DOMAIN=<tenant>.<region>.auth0.com AUTH0_MGMT_TOKEN=<token> scripts/auth0_branding.sh
#
# AUTH0_DOMAIN is the tenant's own *.auth0.com domain, not the custom one (auth.wysebee.com):
# the Management API is only served there. The token is a
# Management API token with read:branding, update:branding, create:branding and
# update:prompts (Dashboard → Applications → APIs → Auth0 Management API → API Explorer).
# LOGO_URL (optional) is the logo shown in the page and widget; default app.wysebee.com's icon.
#
# Steps: brand colours + logo, the theme (auth0/theme.json), the screens' text
# (auth0/custom-text.json), then the page template (auth0/universal-login.liquid). The
# template needs a custom domain on the tenant; without one Auth0 refuses it and the first
# three steps still give a branded, centred page on a light background. Auth0 shows the
# template only on sign-ins that go through the custom domain, so the site's
# WYSEBEE_AUTH_ISSUER must be https://auth.wysebee.com/ for people to see it.
set -euo pipefail

: "${AUTH0_DOMAIN:?set AUTH0_DOMAIN to the tenant *.auth0.com domain}"
: "${AUTH0_MGMT_TOKEN:?set AUTH0_MGMT_TOKEN to a Management API token}"
LOGO_URL="${LOGO_URL:-https://app.wysebee.com/icon.png}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/auth0"
API="https://${AUTH0_DOMAIN}/api/v2"

call() { # method path [body-file]
  local out code body=()
  out="$(mktemp)"
  if [[ $# -ge 3 ]]; then body=(--data-binary "@$3"); fi
  code=$(curl -sS -o "$out" -w '%{http_code}' -X "$1" "$API$2" \
    -H "Authorization: Bearer $AUTH0_MGMT_TOKEN" -H 'Content-Type: application/json' \
    ${body[@]+"${body[@]}"})
  if [[ "$code" != 2* && "$code" != 404 ]]; then
    echo "  $1 $2 → $code: $(cat "$out")" >&2; rm -f "$out"; return 1
  fi
  cat "$out"; rm -f "$out"
}

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "1/4 brand colours and logo"
jq -n --arg logo "$LOGO_URL" \
  '{colors: {primary: "#855cd6", page_background: "#f7f5fc"}, logo_url: $logo}' >"$tmp/branding.json"
call PATCH /branding "$tmp/branding.json" >/dev/null

echo "2/4 theme"
jq --arg logo "$LOGO_URL" '.widget.logo_url = $logo' "$DIR/theme.json" >"$tmp/theme.json"
existing="$(call GET /branding/themes/default | jq -r '.themeId // empty')"
if [[ -n "$existing" ]]; then
  call PATCH "/branding/themes/$existing" "$tmp/theme.json" >/dev/null
else
  call POST /branding/themes "$tmp/theme.json" >/dev/null
fi

echo "3/4 screen text"
for prompt in $(jq -r 'keys[]' "$DIR/custom-text.json"); do
  jq --arg p "$prompt" '.[$p]' "$DIR/custom-text.json" >"$tmp/text.json"
  call PUT "/prompts/$prompt/custom-text/en" "$tmp/text.json" >/dev/null
done

echo "4/4 page template"
jq -Rs '{template: .}' "$DIR/universal-login.liquid" >"$tmp/template.json"
if ! call PUT /branding/templates/universal-login "$tmp/template.json" >/dev/null; then
  echo "  The template was refused (usually: no custom domain on this tenant)." >&2
  echo "  Colours, theme and text are applied; add a custom domain and run again for the full page." >&2
  exit 2
fi

echo "Done. Open the tenant's login page to see it."

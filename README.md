# Wysebee Cloud

Wysebee Cloud is **the website** — the landing page and the web app at `/app/` — and the
service the **Wysebee Agent apps** (the browser extension, Mac, Windows and Android) pair with,
through `/api/v1/browser-links` and `/api/v1/agent-links`. It is a FastAPI service that serves
the React front ends (`apps/` for Python, `ui/` for the front end, Vite building straight into
the Python app).

(Wysebee Desktop and the Wysebee apps for iOS and Android are no longer served, 2026-11-15, the
person's call; migration 0062 dropped what only they used — see [Migrations](#migrations).)

The landing page is a sign-in page; a signed-in visitor goes straight to the web app at `/app/`.

```
apps/cloud/     FastAPI app (main.py), settings (config.py), PostgreSQL engine (db.py),
                request dependencies (deps.py), ORM models (models.py); SPA built into dist/
migrations/     Alembic migrations (run automatically when the container starts)
scripts/        start.sh — the container entrypoint: migrate, then serve
ui/cloud/       the landing page (React + Vite + Tailwind), built into dist/
ui/app/         the web app at /app/ — Home, Wysebee's settings, tasks — built into dist/app/
ui/shared/      theme.css (the brand palette) and cn.ts
tests/          pytest
```

**Self-hosting**: the same code runs as one person's own server with `WYSEBEE_EDITION=selfhost`.
There's no Auth0, no extension and no account deletion: every request is the owner, optionally
behind a shared token (`WYSEBEE_SELFHOST_TOKEN`). Start it with `./scripts/selfhost.sh`, which walks
you through the first run; see [docs/self-hosting.md](docs/self-hosting.md).

**AI apps propose, the person approves**: through Wysebee Assistant an AI app may read, run what
the person approved, and propose changes — never change what an agent can do itself. Every
Assistant tool follows [docs/ai-apps-propose.md](docs/ai-apps-propose.md).

## Develop

The full workflow (the local stack with mock sign-in, the three clouds) is in
[docs/development.md](docs/development.md).

Everything in Docker (web and PostgreSQL; sign-in is Auth0, hosted — see [Sign-in](#sign-in-auth0)):

```bash
./scripts/dev_up.sh            # creates .env if missing, builds, starts in the
                               # background, waits until healthy
./scripts/dev_up.sh --ngrok    # ...then runs the ngrok tunnel (scripts/ngrok.sh)
./scripts/dev_up.sh --logs     # ...then follows the web app's logs
./scripts/dev_up.sh --down     # stops everything (data stays in the volumes)
```

(It is `docker compose up -d --build --wait` with those checks.) Open http://localhost:8000. Postgres is also published on localhost:5432
(user/password/db `wysebee`) for psql or a GUI. Data lives in the `pgdata` volume;
`docker compose down -v` wipes it.

Or run the app on the host against the compose database:

```bash
docker compose up -d db
uv sync
cd ui && yarn install && yarn build && cd ..
uv run uvicorn apps.cloud.main:app --reload
```

Open http://localhost:8000. For hot reload on the front end, run `cd ui && yarn dev`
(the landing page, port 5173) or `yarn dev:app` (the web app, http://localhost:5174/app/);
both proxy `/api` to :8000. `yarn test` runs the web app's tests (100% coverage with
`--coverage`), `yarn check:locales` its translations.

### Mock sign-in (no Auth0)

With `WYSEBEE_AUTH_MOCK=true` in `.env` (and the `WYSEBEE_AUTH_*` Auth0 values left
empty) the app is its own OpenID Connect provider at `http://localhost:8000/mock-auth/`
(`apps/cloud/mock_auth.py`): its sign-in page asks only for a name and email and signs you
in as that person (`sub` = `mock|<email>`). `GET /api/v1/web/config` announces it (client
`wysebee-web-local`), so the landing page and `/app/` run their real sign-in flow against it
unchanged. Its signing key is kept on the `mockauth` volume, so
sign-ins survive a restart. Settings refuse it on any issuer other than localhost; never
set it in a deployment. Assets, skill files and workspaces are files on the compose volumes
either way.

Tests: `uv run pytest`. Set `WYSEBEE_TEST_DATABASE_URL=postgresql://wysebee:wysebee@localhost:5432/wysebee_test`
(a database of its own, its name ending in `_test` — the tests refuse any other, and make it
when it is not there: the migration tests downgrade it to 0005 and back, dropping everything
newer) to also run the database tests.
`uv run pytest --cov` measures `apps/` and fails below 100% of lines (pyproject.toml,
`[tool.coverage]`); it reaches 100% only with the database tests on. The Azurite tests
(`WYSEBEE_TEST_AZURITE_CONNECTION_STRING`) are extra: the lines they run are covered without them.

## API

- `GET /api/health` → `{"status": "ok"}` — liveness; never touches the database
- `GET /api/ready` → 200 `{"database": "up"}` or 503 — readiness; pings PostgreSQL
- `GET /api/healthcheck` → everything at once, for people and monitors: version, uptime,
  database status and latency (or the error *type*, e.g. `ConnectionTimeout`), and whether
  the schema is at this build's migration head. 503 when the database is down; `degraded`
  (200) when migrations are behind.
- `GET /api/v1/web/config` → what the site's pages need at runtime: where to sign in
  (`auth.issuer`, `auth.client_id` = the site's Auth0 application, `auth.audience`) and
  whether to send usage events (`analytics.enabled`).
- `POST /api/v1/events` → a page's batch of usage events, kept in Postgres and forwarded to
  Mixpanel; signed in, or with an `anonymous_id`. See [Usage events](#usage-events-kept-in-postgres-forwarded-to-mixpanel-this-site-only).
- `GET /api/v1/me` → the signed-in caller (`sub`, `username`, `email`, `name`) from a
  Auth0 access token; see [Sign-in](#sign-in-auth0).
- `DELETE /api/v1/account` → deletes the caller's account for good, as Google Play asks: their
  files, every row naming them and their Auth0 identity. Each extension is asked first, and may
  refuse with its own status and code, nothing deleted ([Extensions](#extensions)). 503
  `account_deletion_unavailable` without `WYSEBEE_AUTH0_MGMT_*`; 502 when it should be tried
  again. See `apps/cloud/account_deletion.py`, also a command for requests made by email.
  **Production needs** a machine-to-machine application in the Auth0 tenant, allowed the
  Management API's `delete:users` scope and nothing else: `WYSEBEE_AUTH0_MGMT_DOMAIN` (the
  tenant's own `*.auth0.com` domain, not a custom one), `WYSEBEE_AUTH0_MGMT_CLIENT_ID` and
  `WYSEBEE_AUTH0_MGMT_CLIENT_SECRET` (a Container Apps secret).
- `GET /api/v1/info` → name/version/status
- `GET|POST /api/v1/agents`, `GET|PUT|DELETE /api/v1/agents/{id}` → the person's agents, by
  id, renamed by a put (see [Agents](#agents))
- `GET|POST /api/v1/tasks`, `GET|PUT|DELETE /api/v1/tasks/{id}` → the person's tasks, by id
  (see [Tasks](#tasks)); `GET /api/v1/configs/events` → the change feed
- `PUT /api/v1/assets`, `GET|DELETE /api/v1/assets/{id}` → the person's own small images,
  named by their SHA-256 — agents' pictures (see [Assets](#assets))
- `GET|POST /api/v1/skills`, `GET|PUT|DELETE /api/v1/skills/{id}`,
  `GET|PUT /api/v1/agents/{agent_id}/skills` → the person's skills, by id, and which of their
  agents has which (see [Skills](#skill-files))
- `PUT /api/v1/skill-files`, `GET|DELETE /api/v1/skill-files/{id}` → the files of the
  person's skills, any bytes, named by their SHA-256 (see [Skill files](#skill-files))
- `/api/v1/workspaces[/{id}[/files|folders/{path}]]` → the person's workspaces: documentation
  folders in the `user-workspaces` container, kept under each workspace's id, files named by
  their paths (see [Workspaces](#workspaces)); an id is taken with or without its dashes
- `/api/v1/data/{table}[/{key}]` → the person's Wysebee data: task runs, reminders, the
  settings that follow them, the Tasks order (see [User data](#user-data))
- `/api/v1/browser-links...` → the Wysebee Agent browser extension, paired with this cloud
  and driven through it (see [The browser link](#the-browser-link-apiv1browser-links))
- `/api/v1/agent-links...` → the same routes, for links of either kind: the browser
  extension's, or Wysebee Agent for Mac's (see [A second kind of link](#a-second-kind-of-link-wysebee-agent-for-mac-apiv1agent-links))
- Interactive docs: `/docs`
- Everything else that isn't `/api/*` serves the SPA.

## Sign-in (Auth0)

Sign-in is **Auth0**, hosted: nothing runs locally. One tenant for development and one
for production is the usual split; each needs the setup below once, in the Auth0
dashboard, and this app's `.env` / container settings pointing at it:

| Setting | Value |
|---|---|
| `WYSEBEE_AUTH_ISSUER` | `https://<tenant>.<region>.auth0.com/` (or the custom domain, `https://auth.wysebee.com/`) |
| `WYSEBEE_AUTH_AUDIENCE` | the API's identifier, default `https://wysebee.ai/api` — a name in Auth0, not an address: the site is `app.wysebee.com`, and an API's identifier cannot be changed once tokens carry it |
| `WYSEBEE_AUTH_WEB_CLIENT_ID` | the website application's Client ID |
| `WYSEBEE_AUTH_CONNECTION` | optional: the one Auth0 connection every sign-in goes to (`email` = the email code alone); unset = all of them |

All unset (the default), sign-in is off: `/api/v1/me` answers 503 and the landing page says
sign-in isn't available. (`WYSEBEE_AUTH_CLIENT_ID`, Wysebee Desktop's Native application, is
no longer read.)

**1. The API** (Applications → APIs → Create API): identifier `https://wysebee.ai/api`
(any URI; it is never fetched — it is `WYSEBEE_AUTH_AUDIENCE`), signing algorithm RS256.
Turn on **Allow Offline Access** (refresh tokens). Clients ask for it as `audience` when
signing in; without that, Auth0 issues an opaque access token this API cannot verify.

**2. The website** (Create Application → **Single Page Application**), for the landing
page and `/app/`, per site address (`http://localhost:8000`, `http://localhost:5173` and
`http://localhost:5174` for `yarn dev` / `dev:cloud`, the ngrok URL, `https://app.wysebee.com`):
- **Allowed Callback URLs**: `<site>/auth/callback` and `<site>/app/`
- **Allowed Logout URLs**: `<site>/`
- **Allowed Web Origins**: `<site>`
- **Refresh Token Rotation**: on (the pages renew tokens with it, not with a hidden
  iframe, which browsers' third-party-cookie blocking breaks).
- Its Client ID is `WYSEBEE_AUTH_WEB_CLIENT_ID`.

**3. The tenant**:
- Sign-ups: Authentication → Database → the connection's **Disable Sign Ups** off, and
  enable it for the website's application. Google / Microsoft: Authentication → Social.
- Settings → Advanced → **RP-Initiated Logout End Session Endpoint Discovery** on, so
  Sign out ends the Auth0 session the standard way (the pages fall back to Auth0's
  `/v2/logout` without it).
- Branding → Universal Login: `scripts/auth0_branding.sh` applies the Wysebee look from
  `auth0/` — brand purple `#855cd6` and logo, the theme (`theme.json`), the screens' text
  (`custom-text.json`, which replaces "Log in to My Company to continue to My App") and the
  split-screen page (`universal-login.liquid`). The page template needs a custom domain on
  the tenant; without one the rest still applies.

**4. Passwordless: a code by email** (beside the password and social logins, not instead):
- Authentication → Passwordless → **Email** on. In its Settings: the sender, subject and
  message (keep `{{ code }}` in it), the code's length and expiry; leave **Disable Sign
  Ups** off so a new person can make an account this way.
- The connection's **Applications** tab: enable the website's application.
- Authentication → Authentication Profile → **Identifier First**: Auth0's page asks for the
  email first, then offers the code.
- Nothing in the site changes for it — it sends the person to Universal Login as
  before, with authorization code + PKCE, so the Grant Types above stay as they are (the
  *Passwordless OTP* grant is only for an app that asks for the code itself, which the site
  does not). To send every sign-in straight to the email code, set
  `WYSEBEE_AUTH_CONNECTION=email`: it is announced as `auth.connection` in
  `/api/v1/web/config`, and the landing page and `/app/` pass it as `connection` on
  `/authorize` — no release needed.
- **One email can be two people.** Auth0 makes a separate user (`sub` `email|…`) for an
  email-code sign-in, so someone who signed up with a password or Google and then signs in
  with a code reaches a different, empty Wysebee — unless the accounts are linked in Auth0
  (an account-linking Action, or Auth0's Account Linking extension).
- Auth0 names a passwordless user by their email; `/app/` then shows the
  nickname (the part before the @) instead, until the person sets a display name.

**What this API checks.** It announces the tenant to the site in `GET /api/v1/web/config`
(`auth.issuer`, `auth.client_id`, `auth.audience`, `auth.connection`) and
accepts the resulting access tokens as `Authorization: Bearer …`: signature checked against
the tenant's keys (`<issuer>.well-known/jwks.json`, cached), `iss` = `WYSEBEE_AUTH_ISSUER`
(a trailing `/` is added, as Auth0's tokens have it), `aud` contains
`WYSEBEE_AUTH_AUDIENCE`, not expired. The token's `azp` names the application that asked.
Routes opt in with `user: User = Depends(current_user)`
(`apps/cloud/auth.py`); `GET /api/v1/me` answers 401 without a valid token, 503 when no
issuer is configured. Auth0 access tokens carry the user id (`sub`, e.g. `auth0|…` or
`google-oauth2|…`) but not the email or name — those come from the ID token each client
keeps.

### Sign up and sign in on this site

The site's own pages (the React app) have **Sign up** and **Sign in** in the header.
Both send the browser to Auth0 as the website's application — public, authorization
code + PKCE, `audience` = this API, back to `<site>/auth/callback` (`ui/cloud/src/auth.ts`,
`oidc-client-ts`); **Sign up** adds `screen_hint=signup`, which opens Auth0's sign-up form.
Signed in, the visitor goes straight to `/app/`, whose **Sign out** also ends the Auth0
session. Under it, **Delete account** (Account → Profile, `ProfileView/DeleteAccount.tsx`,
2026-11-07) confirms, calls `DELETE /api/v1/account` and then signs out. Tokens live in localStorage and the access token renews in the background with
the refresh token. A new site address needs adding to the application's callback,
logout and web-origin lists in Auth0.

The page learns where to sign in, and whether to send usage events, from
`GET /api/v1/web/config` at load time — nothing is baked into the build.

### Usage events: kept in Postgres, forwarded to Mixpanel (this site only)

**Since 2026-11-15 every usage event is kept in our own database as well as in Mixpanel.** The
landing page (`ui/cloud/src/analytics.ts`) and the web app (`ui/app/src/telemetry.ts`) post
their events to **`POST /api/v1/events`** (`apps/cloud/usage_events.py`), which stores each one
in the `usage_events` table (migration 0068) and then, when `WYSEBEE_MIXPANEL_TOKEN` names a
project (and `WYSEBEE_MIXPANEL_API_HOST=https://api-eu.mixpanel.com` for an EU-resident one),
forwards the batch to Mixpanel's `/track` from the server. Until then the pages posted to
Mixpanel themselves; the landing page no longer loads Mixpanel's library, and `/app/`'s CSP no
longer names a Mixpanel host. A Mixpanel failure is logged and that batch is not sent again;
the rows are kept all the same. Without a Mixpanel token, events are only kept.

- **On or off**: `WYSEBEE_EVENTS_ENABLED` (default on). The pages read it as `analytics.enabled`
  in `GET /api/v1/web/config` and send nothing when it is off; the route then answers 404.
- **Who**: the signed-in person's Auth0 `sub`, read by the server from their access token —
  the page never names anyone. Before sign-in the landing page sends a random `anonymous_id`
  it keeps in localStorage (`wysebee.anonymous_id`); Mixpanel gets it as `$device_id`, so the
  visit before signing in joins the person after. A token that is given must be valid (401).
  Never a name, email or username.
- **What is kept** (one row per event): `event`, `occurred_at` (the page's time, believed
  within a week before and an hour after arrival), `received_at`, `user_id`, `anonymous_id`,
  `session_id`, `insert_id` (Mixpanel's `$insert_id`), `surface` (`web` or `landing`), `page`
  (the masked route, or the landing page's path), `app_version`, `language`, and the event's own
  `properties` (JSONB, at most 8 KB, else none). Never the person's address (Mixpanel gets it
  as `ip`, for the country, as the pages' own posts gave it), and never typed text: the pages
  mask names, emails, URLs, paths and ids first (below), and the server drops `$`-prefixed
  properties and the names it sets itself.
- **Limits**: at most 50 events a post, and `WYSEBEE_EVENTS_BATCHES_PER_MINUTE` (30) posts a
  minute for each person or, before sign-in, each address, on each replica (429).
- **Kept** `WYSEBEE_EVENTS_RETENTION_DAYS` (395, 13 months; 0 keeps them for good), deleted
  daily (`WYSEBEE_EVENTS_PURGE_SECONDS`). Deleting an account deletes its events, and the ones
  from before sign-in on the same browser (same `anonymous_id`).
- **Searching**: SQL for now, on indexes by time, person, anonymous id and event name, and a
  GIN index on `properties`. For example:

  ```sql
  SELECT occurred_at, event, page, properties FROM usage_events
   WHERE user_id = 'auth0|…' AND occurred_at > now() - interval '7 days' ORDER BY occurred_at;
  SELECT count(*) FROM usage_events WHERE event = 'Click' AND properties @> '{"label": "Save agent"}';
  ```

**The landing page's events**: `Page Viewed` (`path` only, never the query string),
`Sign Up Clicked`, `Sign In Clicked`, `Sign In Started`, `Signed Up`, `Signed In`,
`Sign In Failed` (`cancelled`); each with `app: wysebee-cloud-web`, posted one at a time with
`keepalive` (most are sent just before the page leaves). Do Not Track is honoured. `Sign In
Started` (`automatic: true`) is sent on load, before any click, so it is not a funnel's first
step: nothing is sent from a browser a program drives (`navigator.webdriver`).

**Bots** (2026-11-27): `POST /api/v1/events` answers 204 but neither keeps nor forwards a batch
whose `User-Agent` is a crawler's, link previewer's, monitor's, headless browser's or script's,
or is missing (`is_bot` in `apps/cloud/usage_events.py`). Mixpanel gets `$browser` and `$os`
read from the user agent; the agent string itself is not kept.

**The web app's events** (`ui/app/src/telemetry.ts`, since 2026-10-28), **only if the person
allows it**: their "Send usage analytics" (`telemetry_enabled`, the setting that follows them;
Settings → System), read before anything is sent. Batched every 5 s, at most 50 a post, and
once more as the page is hidden (`fetch` with `keepalive`, carrying the last token). `Click` for
every button, link, tab, switch or checkbox pressed (its `data-track`, else its label
with the person's names, emails, URLs and paths masked; `(private)` inside
`data-track-private`), `App Started`, `Page Viewed`, and the screens' own events — each with
`page` masked (`/agents/:name`, `/tasks/:id/run`), `surface: "web"`, `session_id`,
`language`, `time` and `insert_id`. Mixpanel gets them with `distinct_id` / `$user_id` /
`user_id` the Auth0 `sub`, as before. Never message text, names, emails or ids.

## Connect AI app: every agent in your own AI app, through Wysebee Assistant (`/assistant/mcp`)

**One connector, Wysebee Assistant's** (2026-11-14, the person's call; from 2026-11-13 each
agent had its own `/mcp/<agent>`, and those addresses are gone; `apps/cloud/agent_mcp.py`). A
signed-in person adds `https://app.wysebee.com/assistant/mcp` to Claude or ChatGPT once, as a custom
connector (a remote MCP server). It offers:

- **the page open with [Wysebee Assistant](#wysebee-assistant-your-ai-app-writes-the-open-page)**
  in Workspaces (`read_document`, `write_document` …), while it is on;
- **every agent's tools, Wysebee's among them**: `list_agents`, `list_agent_tools {agent}` (each
  tool marked `readOnlyHint` or not), and `call_agent_read_tool` / `call_agent_tool {agent, tool,
  arguments}` run them from each agent's toolbox. **No one tool both reads and acts**
  (2026-11-16; Claude's connector directory rejects one that does): `call_agent_read_tool`
  (read-only) runs only the tools `toolbox.READ_ONLY` names — a page snapshot or screenshot, a
  folder or skill file, a table list, a SQL query, run read-only whatever the connection allows —
  and `call_agent_tool` (destructive) only the rest, and a SQL query where the connection allows
  changes; each refuses the other's with which to use. They run
  (`agent_chat/toolbox.py` `toolbox`) — its skills
  (`load_skill`, `skill_read_file`), its PostgreSQL and Snowflake connections, a browser-paired
  agent's browser pack (through its link to the Wysebee Agent extension, which still decides
  per site and per action) and a Mac-paired agent's programs, skill scripts and folders
  (through Wysebee Agent for Mac, which still decides what runs; a folder picture, the
  person's alone, is not passed to the AI app's model).

No model runs here: the AI app is the model. **Each tool call answered is counted**
([Tool calls](#tool-calls-counted-per-person-and-month)); `list_agents` and `list_agent_tools` are not counted.

**Every agent lives in Wysebee Cloud**, so every agent is reachable; an unknown handle — or
another account's — is "no such agent". (The relay to Wysebee Desktop, 2026-10-26 to
2026-11-11, is gone: `/api/v1/relay/*` answers 404, migration 0062 dropped its tables, and
`WYSEBEE_RELAY_ENABLED` is no longer read.)

Stateless Streamable HTTP: a `call_agent_tool` answers as server-sent events with keepalive
comments while the tool runs, and is stopped (the browser or Mac op cancelled) after
`WYSEBEE_MCP_CALL_WAIT_SECONDS` (200, under the ingress's 240 s). `WYSEBEE_MCP_ENABLED`
(true by default) turns it all off; `WYSEBEE_PUBLIC_URL` names the site in the OAuth metadata
when the proxy headers don't. **The website shows it** in each agent's settings → **Connect AI
app**, Wysebee's included: the address (the same for every agent), the agent's tools and skills,
why a browser's agent cannot act now, and **a switch** — from `GET /api/v1/mcp/status?agent=`
(`{url, exposed, tools, skills, offline}`) and `PUT /api/v1/mcp/agents/{agent}` `{exposed}`. An
agent turned off, Wysebee included, is neither listed by `list_agents` nor run; it is kept in
`mcp_hidden_agents` (migration 0054), not in the agent's settings, which clients rebuild on
save — by the agent's id since migration 0063, so renaming an agent keeps it off, and deleting
it deletes the row.

**Sign-in for the AI app is the tenant's**, through MCP's OAuth discovery: `/assistant/mcp`
answers 401 with `WWW-Authenticate: Bearer resource_metadata=…`, and
`/.well-known/oauth-protected-resource/assistant/mcp` (RFC 9728) names the Auth0 issuer. The
app then identifies itself there and signs the person in. `/assistant/mcp` accepts **the same tokens as
the rest of this API** (`aud` = `WYSEBEE_AUTH_AUDIENCE`). In the Auth0 dashboard, once
per tenant (tried end to end on production with claude.ai, ChatGPT and Claude Code, 2026-11-16):

- **Client ID Metadata Documents (CIMD) on**: the AI app's client id is the URL of a
  document describing it, so nothing is registered per connection. Production's
  `https://auth.wysebee.com/.well-known/openid-configuration` advertises
  `client_id_metadata_document_supported: true` and `none` among
  `token_endpoint_auth_methods_supported` — both are needed for Claude to use CIMD — and no
  `registration_endpoint` (Dynamic Application Registration off). Those apps are third-party:
  **promote the database and social connections to domain level** (Authentication → each
  connection → "Promote Connection to Domain Level"), or they have no way to sign in.
- Settings → General → **API Authorization Settings → Default Audience** =
  `WYSEBEE_AUTH_AUDIENCE` (`https://wysebee.ai/api`). AI apps send
  `resource=…/assistant/mcp`, not `audience`; with the default set, Auth0 issues a JWT for this
  API that `/assistant/mcp` accepts. Leave the **Resource Parameter Compatibility Profile** off,
  or Auth0 asks for an API whose identifier is the `/assistant/mcp` URL instead.

## Users

The **`users`** table (`apps/cloud/users.py`, migrations 0019–0020) keeps each person: their
Auth0 `sub`, the email and name the site last gave (`PUT /api/v1/me`, which the website sends
on signing in), and **their
profile** — `display_name` and `avatar` (an emoji, or `asset:<id>` in the asset store), read
and written with `GET`/`PUT /api/v1/profile` (only what is sent changes; it was `profile` on
Wysebee's agent settings until migration 0020 copied it here). Who is here, from the app's
own command, run in the container (`az containerapp exec -n <app> -g <group> --command "…"`)
or locally with `uv run`:

```bash
python -m apps.cloud.users list                         # each person: email, name, sub
```

`ai_enabled` (who could use Wysebee AI) and the Wysebee AI waitlist (`ai_waitlist`,
`/api/v1/waitlist`) went on 2026-10-28 with the hosted chat they gated: migration 0025 dropped
both.

## Wysebee Admin (`admin_users`)

**Wysebee Admin** (the `wysebee-admin` repository) is a desktop app that reads and changes
this database directly — the server metadata, the people, a read-only table viewer and
SELECT queries. Who may sign in to it is the **`admin_users`** table (migration
0021: an email, an Argon2 password hash, `is_super`), made with its own
`scripts/set_admin_password.sh --env <env> <email> --super`. Nothing in this service reads it.

## No chat, no AI model in Wysebee Cloud

**Every agent lives in Wysebee Cloud** (2026-11-13; migration 0049 moved the ones that lived on
a desktop, and 0062 took the `home` / `home_name` they carried out of their settings).

**No chat, no AI model** (2026-11-14, the person's call). Remote turns
(`/api/v1/turns`), the model round (`/api/v1/chat`), Home's chat
turns (`/api/v1/chat-turns`), Home's topics and conversations in `/api/v1/data`, AI-answer
reports (`/api/v1/reports`) and the agents' API (`/api/v1/agent-keys`, `/api/v1/agents/{agent}/chat`)
are gone, and so are the AI provider keys (`WYSEBEE_ANTHROPIC_API_KEY`,
`WYSEBEE_OPENAI_API_KEY`, `WYSEBEE_DEFAULT_MODEL`). An agent's tools are used from the person's
own AI app, through Wysebee Assistant (see [Connect AI app](#connect-ai-app-every-agent-in-your-own-ai-app-through-wysebee-assistant-assistantmcp)).
Their tables `user_topics` and `user_conversations` stay, no longer written; account deletion
still empties them. (`remote_turns` went with migration 0062; `user_chat_turns`,
`content_reports` and `cloud_agent_keys` with 0063.)

## Your Wysebee on the web (`/app/`)

A signed-in person's Wysebee is viewed and changed at **`/app/`**. The landing page sends a
signed-in visitor straight there. The rail is **Home**, **Workspaces**, **Tasks**, **Agents**,
**Activity** (badged while some notifications are unread) and **More** (⋯; since 2026-11-19 a
menu of **Skills**, **Tools** and **Devices**) (`ui/app/src/components/SideNav/Sidebar.tsx`):

- **Home** (`#/home`; a dashboard since 2026-11-19, `HomeView.tsx`), in two columns. Left: the
  person's **workspaces** (each opening it, with when it changed), then their **agents** (each
  with its presence and the device it works on, opening its settings). Right: their **tasks**
  (each with its kind and last run, opening it), then their **devices** (Wysebee Cloud, then
  each paired Mac, Windows PC, Android phone and browser, with its status). Each section shows
  its count and at most five rows; its **View all** opens its page. Workspaces, Agents and Tasks
  each have a **+**: a workspace's start form, the Add an agent dialog (its settings open once
  added) and a new task.
- **Agents** (2026-10-25; its own page `#/agents[/<id>[/<tab>]]` since 2026-11-19, Home until
  then, whose `#/home/agent/<id>` addresses still open it): an agent is added (**+**, a name and its "@" handle), set up
  (General, Tools, Instruction), renamed (its handle, since 2026-11-16) and deleted here —
  rows of `user_agents`, through [`/api/v1/agents`](#agents) (`ui/app/src/cloud/home.ts`).
- **Pairing a browser** (2026-11-11): the **Devices** page has a **Browsers** section — the
  account's paired browsers, **Unpair**, and **Pair a browser**, where the person types the
  code the Wysebee Agent extension shows. That creates a new agent living in Wysebee Cloud,
  the only one that drives that browser; its Tools show Browser access and Web development
  tools ([The browser link](#the-browser-link-apiv1browser-links), `ui/app/src/cloud/browserLinks.ts`).
- **Pairing a device** (2026-11-13; a Windows PC and an Android phone 2026-11-16): **Your
  devices** on the same page (`DesktopsSection.tsx`) lists Wysebee Cloud, then each Mac, Windows
  PC and Android phone paired with Wysebee Agent, with **Unpair**, and has **Pair a device** — a
  menu of **Pair a Mac**, **Pair a Windows PC** and **Pair an Android phone**, each the same
  dialog in that device's words. That creates a new agent living in Wysebee Cloud, which this
  server runs with that device's tools (a Mac's or PC's programs, skill scripts and folders)
  ([A Mac agent living in Wysebee Cloud](#a-mac-agent-living-in-wysebee-cloud-2026-11-13)).
- **The Agents page** (Home's until 2026-11-19): the person's agents, Wysebee first, in the menu beside the rail; each opens its
  settings. The Hub, topics and direct messages went with chat (2026-11-14). **Each agent shows
  online or offline** (`ui/app/src/presence.ts`): a dot on its picture — a browser's agent is
  online while its extension polls and is not paused, and (since 2026-11-19) an agent paired
  with a Mac, Windows PC or Android phone while that device does; any other agent is online.
  The links are read every 30 s.
- **Wysebee's settings** (its picture or the gear): **Tools** — Browser access and the web
  development tools as switches; the five site tools (Gmail, Calendar, Travel, News,
  Website), PostgreSQL and Snowflake connections and a Mac agent's programs as the person's
  **tools** — made, changed, given and taken away at once, and the library listing the person's
  tools this agent lacks with a + to give each ([Tools](#agents-living-in-wysebee-cloud) below) — **Skills** (a tick per skill of the library, saved at once to `agent_skills` by the
  skill's id; and since 2026-11-13 **New skill**, change, rename and delete, with files — [Skill files](#skill-files)) and **Instruction**. Saved to Wysebee's own agent
  (`PUT /api/v1/agents/{id}`). **A Mac agent's programs are its `program` tools** (2026-11-15;
  set up here since 2026-11-13): Run local program's **+** and each program's pencil open the
  program dialog (`ui/app/src/components/AgentsView/LocalProgramDialog.tsx`, `ProgramFields.tsx`;
  the program is typed — a page cannot pick a file on the Mac), saved at once. Other open pages
  hear of a save at once through the change feed.
- **What an agent's settings no longer hold** (`DROPPED_FIELDS` in `ui/app/src/cloud/home.ts`)
  is never shown, and a save here drops it: where it lived and one computer's own tools
  (`home`, `home_name`, `browser`, `sqlite_database`, `local_programs`, `postgres_databases`,
  `snowflake_databases` — gone with migration 0062); the tools removed on 2026-11-12, the
  person's call (Docker, Run in a container, the Android and iOS Development Toolkits, the old
  `folders`, `camera`); and the site links and skills, which are tools and skills of their own.
- **The Tools page** (`#/tools`, 2026-11-15; `ui/app/src/components/ToolsView.tsx`), under
  More on the rail: the Tool library's kinds of tool in its tabs — Local File & Folder,
  Website, Database — then the person's own tools of each, on the same cards as an agent's
  Tools tab (`ToolCards.tsx`). A tool only some agents may have carries a tag saying which:
  **Browser agents** (Browser access, the web development tools, the site tools) or **Mac
  agents** (Run local program, Local Folder) — by the agent types (`GET /api/v1/agent-types`), as the Tools tab
  ([Which agent may add which tool](#which-agent-may-add-which-tool)). **Each card's + opens a
  menu of the person's agents and gives the tool to the one picked**, with the Tools tab's own
  calls: one of the person's tools is added to the agent's tools of its kind
  (`PUT /api/v1/agents/{agent_id}/tools`); a template opens its dialog for that agent first —
  a PostgreSQL or Snowflake connection or a program is made (`POST /api/v1/tools`) and given, a
  site tool's dialog edits the links that agent has; Browser access and the web development
  tools are turned on in the agent's settings (`PUT /api/v1/agents/{id}`). In the menu an
  agent of another kind is greyed with which kind may (a browser agent is one with
  `browser_link`, a Mac agent one with `mac_link`; the agent list says so), and one that has
  the tool already is greyed "Has it". Local Folder has no +: a Mac's folders are picked on the
  Mac. No server change: the server still refuses a wrong kind (422 `wrong_agent_kind`).
- **No Tools or Skills page from 2026-11-12** (the person's call): from 2026-10-29 `#/tools`
  and `#/skills` were rail pages listing every tool and the skills library; then an old link
  opened Home, until Skills (2026-11-17) and Tools (2026-11-15) were pages again.
- **Tasks**: as before, plus each task's **Run** tab — its runs
  (`/api/v1/data/task_runs`), read only — and the reminders still to come, which can be
  cancelled.

- **Source**: `ui/app/` — first copied from wysebee-desktop's screens (2026-10). The screens
  call admin API paths; `ui/app/src/cloud/` answers some in the browser (`router.ts`) — Wysebee,
  Home, runs and reminders from `/api/v1/agents` and `/api/v1/data` (`home.ts`, `data.ts`) —
  and passes the rest, tasks among them (`/api/v1/tasks`, since migration 0065), straight to
  Wysebee Cloud. `cd ui && yarn build` builds it
  into `apps/cloud/dist/app`, after the landing page; the Dockerfile does the same.
- **How tasks are stored**: `ui/app/src/cloud/catalog.json` and
  `ui/app/src/cloud/rows/cloud_rows.json` came from wysebee-desktop; they are this
  repository's own now, and `rows/*` must pass `yarn test` against them.
- **Served** by `apps/cloud/main.py` `_mount_web_app`: its own SPA fallback, immutable
  hashed assets, and a strict CSP (scripts from here only; requests to here and the Auth0
  tenant).
- **Sign-in**: the website's Auth0 application; its callback URLs include `<site>/app/`
  (see [Sign-in](#sign-in-auth0)).
- **Local development**: `cd ui && yarn dev:app`, then http://localhost:5174/app/ against
  this compose stack on :8000.

## Database

`WYSEBEE_DATABASE_URL` is a SQLAlchemy URL using the async psycopg 3 driver
(`postgresql+psycopg://...`; plain `postgresql://`/`postgres://` are rewritten to it).
Routes get a session with `session: AsyncSession = Depends(get_session)` from
`apps.cloud.deps`; ORM models subclass `apps.cloud.db.Base`.

### Migrations

The schema is managed by Alembic. `scripts/start.sh` runs `alembic upgrade head` before
starting the server (a Postgres advisory lock keeps several replicas from migrating at
once); set `WYSEBEE_MIGRATE_ON_START=false` to run it as a separate release step.

```bash
uv run alembic upgrade head                                   # apply
uv run alembic revision --autogenerate -m "add something"     # after changing models.py
```

**Migration 0062** (2026-11-15) drops what only Wysebee Desktop and the old phone apps used,
when they stopped being served: the tables `usage` (usage analytics), `backup_keys` and
`backups` (encrypted cloud backup; the blobs in the `backups` container are not deleted),
`user_desktops` (the desktops' reports), `user_credentials` (their connections' passwords),
`relay_desktops`, `relay_calls` and `remote_turns`; `profile` cloud items (the person's agents
and tasks were cloud items then: [Tasks](#tasks)); each agent's
`DEVICES`; and, from agents' settings, `home`, `home_name`, `postgres_databases`,
`snowflake_databases`, `sqlite_database`, `local_programs`, `browser` and `folders`. Its
downgrade makes the tables again, empty; what it took out of the cloud items is not put back.
`server_metadata` (migration 0018) stays: Wysebee Admin writes it, and nothing in this
service reads it.

**Migration 0063** (2026-11-16) gives agents a table of their own, `user_agents`, keyed by a
UUID `agent_id`, so an agent can be renamed ([Agents](#agents)). Each `agent` cloud item becomes a
row (its `item_id` kept when it was a uuid hex — every agent the website or a pairing made;
Wysebee's own, item `wysebee`, gets a new id) and the items go, tombstones too. Everything that
named an agent by its handle now holds its id: `agent_skills` and `agent_tools` (a foreign key,
deleted with the agent), `browser_links.agent_id` and `mcp_hidden_agents.agent_id` (deleted with
it), `user_notifications.agent_id` and `user_task_runs.agent_id` (cleared when it is deleted),
and each task's steps (`{agent_id, tool, arguments}`). A claimed link whose agent was gone is
deleted. It also drops `cloud_agent_keys`, `user_chat_turns` and `content_reports`, unread since
chat went. Its downgrade puts agents back as cloud items and every reference back to a handle;
the three tables come back empty.

**Migration 0064** (2026-11-16) makes `user_projects.project_id` (and `project_assistants`'s
link) a UUID and keeps a project's files under its id; older projects' files were moved by the
cloud itself (until 0073 dropped projects).

**Migration 0065** (2026-11-16) gives tasks a table of their own, `user_tasks`, keyed by a UUID
`task_id` ([Tasks](#tasks)). Each live `task` cloud item becomes a row (its `item_id` kept — every
one a uuid hex — its `CONFIG` JSON text an object, `CREATOR` its `creator`).
`task_schedules.task_id` and `user_task_runs.task_id` become UUID foreign keys, deleted with the
task; a schedule or run whose task was gone (or never was) is deleted. Tasks were the last kind
of cloud item, so `cloud_configs` is dropped, with `/api/v1/configs` and its tombstones;
`cloud_config_heads` stays as the change counter. Its downgrade makes `cloud_configs` again
with the tasks in it (a uuid's hex as `item_id`) and puts the two links back as text.

**Migration 0067** (2026-11-17) is the Skills page's: `user_skills.folders`, and
`project_assistants` — the page open in the editor — may be a skill's file (`skill_id` beside an
optional `project_id`, exactly one) and says who opened it (`opened_by`: the person, or their AI
app making a skill). Its downgrade drops them, and an open skill file.

**Migration 0066** (2026-11-16) records **who made and who last changed** each agent, tool,
skill, project and task, ahead of sharing (an editor changing what another person owns):
`created_by` and `updated_by`, user ids, on `user_agents`, `user_tools`, `user_skills`,
`user_projects` and `user_tasks`, both the owner (`user_id`) for every existing row.
`user_tasks.creator` (an email, always the owner's) goes. Its downgrade puts `creator` back from
the creator's `users` row.

**Migration 0073** (2026-11-19) renames Projects to **Workspaces**, in the database too
([Workspaces](#workspaces)). Existing projects are not kept: `project_assistants` and
`user_projects` are dropped and `user_workspaces` and `workspace_assistants` made, empty, in
their place (the same columns, `workspace_id` for `project_id`, without the pre-0064 `folder`).
Old projects' files stay, untouched, in the `user-projects` store; workspaces' are in
`user-workspaces`. Its downgrade drops the workspaces and makes the old tables again, empty.

**Migration 0074** (2026-11-19) goes with the skill file store's new Azure container,
**`user-skills`** (was `skill-files`; the file store's folder `./data/user-skills`), named like
`user-assets` and `user-workspaces`. Azure cannot rename a container and the files are not
copied, so saved skills are not kept: every `user_skills` row (with its `agent_skills` and an
open skill page) and every `cloud_skill_files` row is deleted. The old `skill-files` container
is left as it was, to be removed by hand. Its downgrade changes nothing.

## Who made it, who changed it

Since migration 0066 (`apps/cloud/people.py`), every save stamps `updated_by` — and a new one
`created_by` — with whoever made it: the signed-in caller, from the website or their AI app;
the owner, for a device pairing or a Mac's poll writing an agent's settings. Saving, deleting
or adding a folder of a workspace's files is a change to the workspace. Every answer for an
agent, tool, skill, workspace or task names both as `{id, name, email}` from the `users` table —
`name` their display name, else their name; both empty when the cloud knows nothing of them.
`user_id` stays the **owner**: today the same person; once things can be shared, not always.

## Agents

A person's agents (`apps/cloud/agents.py`, table `user_agents`, migration 0063) are kept here
and edited on the website.

- An agent is `{id, name, config, description, created_at, updated_at}`. `id` is a UUID, what
  everything links it by — its skills, tools, paired browser, Mac or phone, tasks' steps, runs
  and notifications — so it can be **renamed**; `name` is its @handle (`^[a-z][a-z0-9_-]{0,29}$`,
  unique per person; not `pairing` or `camera`); `config` its settings (label, instructions, an
  image avatar as an [asset](#assets) `asset:<id>`, which device it is paired with…), at most
  `WYSEBEE_CONFIG_ITEM_MAX_BYTES` (413).
- **Wysebee's own agent is a row too**, named `wysebee`, made the first time the list is read
  (or it is otherwise needed); it is never renamed or deleted (400). Until it is made, what reads
  it by handle (Wysebee Assistant) gets its defaults.
- `GET /api/v1/agents` — `{agents: [...]}`, Wysebee's first, then by name.
- `POST /api/v1/agents` `{name, config, description?}` — 201; a label (one line, 1-60) is
  needed; a name taken (or `wysebee`) is a 409, and so is a 21st agent.
- `GET|PUT|DELETE /api/v1/agents/{id}` — a put sends what changes, a new `name` renames it
  (409 when taken); deleting it deletes its links to its skills, tools and device (the device
  hears on its next poll).
- **A save keeps what only the cloud decides** — which device it is paired with
  (`browser_links.keep_link`) — drops what its settings no longer hold (`user_tools.without_moved`:
  site links and programs, tools of their own since migration 0061, and what only Wysebee
  Desktop wrote — `home`, `home_name`, `postgres_databases`, `snowflake_databases`,
  `sqlite_database`, `browser`, `folders`), is refused when it adds a tool that kind of agent
  cannot have ([Which agent may add which tool](#which-agent-may-add-which-tool)), and bumps the person's revision, so the
  change feed tells their open pages. A pairing and a Mac's folders save through the same path.
- Another person's agent is a 404. Until migration 0063 an agent was an `agent` cloud item,
  named for its handle, its settings JSON text in `data.CONFIG`.

## Tasks

A person's tasks (`apps/cloud/tasks.py`, table `user_tasks`, migration 0065) are kept here,
edited on the website and set up from their AI app ([Scheduled tasks](#scheduled-tasks-reminders-and-periodic-work-run-by-wysebee-cloud)).

- A task is answered as the Tasks page reads it: `{id, name, prompt, description, label,
  browser_access, browser, browser_devtools, trigger, steps, next_run_at, creator, created_by,
  updated_by, created_at, updated_at, last_run, location}` (`creator`: the email of who made it;
  [Who made it, who changed it](#who-made-it-who-changed-it)). `id` is a UUID — what its schedule (`task_schedules`) and
  runs (`user_task_runs`) link by, **deleted with it** — so a task can be renamed. `name` is
  unique per person.
- `GET /api/v1/tasks` → `{"rows": [...]}` by name, each with when it is next due.
  `POST /api/v1/tasks` `{name, trigger?, prompt?, description?, label?, browser_access?,
  browser?, browser_devtools?, steps?}` → 201 the task, made by the caller.
  `GET|PUT|DELETE /api/v1/tasks/{id}` — a put sends what changes (`name` renames it).
- **The server checks a task** (the website did, in the browser, until 0065): a name of 1 to
  200 characters (a name the person already has: 409); `prompt` at most 50,000 characters,
  `description` 2,000, `label` and `browser` 200; an emptied field is dropped; `steps` a list
  of at most 10 `{agent_id, tool, arguments}`; a trigger as the AI app's is checked
  (`task_runner.clean_trigger`) — one sent back as stored is not checked again, so a timer
  already past survives a rename. Every save works out when it is next due.
- Another person's task is a 404. Last write wins: there is no revision to send back.
- Until migration 0065 a task was a `task` **cloud item** (`cloud_configs`, `/api/v1/configs`,
  with revisions, `If-Match`, tombstones and a batch route). Tasks were the last kind; cloud
  items went with them.

### The change feed

Several pages (and the cloud itself — a pairing, a Mac's folders, a task the AI app saved)
change a person's agents and tasks, so every such save bumps the person's **revision** — one
counter per person (`cloud_config_heads`, `apps/cloud/changes.py`), in the save's transaction.

- **`GET /api/v1/configs/events`** — server-sent events: `hello` with the revision, then a
  `changes` frame (`{"revision", "changes": []}`) whenever it moves — it names nothing; the page
  reads again what it shows — `activity` when the unread notifications change, and a ping every
  20 s. Resume with `Last-Event-ID` or `?since=`. Bearer auth (browsers use `fetch` streaming,
  not `EventSource`). A stream ends at its token's expiry or after 230 s
  (`WYSEBEE_CONFIG_EVENTS_MAX_SECONDS`, under Azure's ingress limits) and the client reconnects.
- **Across replicas**: each save `pg_notify`s; every replica `LISTEN`s on one dedicated
  connection and wakes its streams. **That connection must reach Postgres directly**, not
  through PgBouncer in transaction mode (`WYSEBEE_CONFIG_EVENTS_LISTEN=false` falls back to
  each stream checking every heartbeat).

## User data

A person's task runs, reminders, the settings that follow them and the Tasks order are kept in
`user_task_runs`, `user_reminders`, `user_settings` and `user_nav_order` (migration 0011), each
keyed by the person's `sub` first (`apps/cloud/userdata.py`), read and written by the website
and the cloud's own scheduler. Tasks themselves are [Tasks](#tasks)' (a run is deleted with its task). (`user_topics` and
`user_conversations`, Home's, went unwritten with chat on 2026-11-14.)

- `GET /data/{table}` (`?task_id=`, `?limit=`, reminders' `?pending=1&due_before=`),
  `GET|PUT|DELETE /data/{table}/{key}`, `DELETE /data/task_runs?task_id=` (a task's runs),
  `POST /data/reminders/{key}/deliver` (marks it delivered once: `{"delivered": true}` for
  the one caller that did, so two never both post it).
- A row is at most 256 KiB, a task run 16 MiB. Another person's row is a 404.
- **No secret is stored in these tables.**

## Assets

Small images a person stores here, private to them (`apps/cloud/assets.py`): agents' and the
person's pictures — the website uploads the image here and keeps only its id in the settings.
Every route needs a signed-in caller; another person's asset is a 404.

| Route | Does |
|---|---|
| `PUT /api/v1/assets` | The body is the file's bytes; `Content-Type` one of `image/png`, `image/jpeg`, `image/webp`, `image/gif` (else 415; parameters ignored). Empty is 422, over `WYSEBEE_ASSET_MAX_BYTES` 413. Answers 200 `{"id", "content_type", "size"}` |
| `GET /api/v1/assets/{id}` | The bytes, with the stored content type, `Cache-Control: private, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff` |
| `DELETE /api/v1/assets/{id}` | 204, or 404 |

**Content-addressed**: the id is the lowercase hex SHA-256 of the bytes, so a client can
compute it itself, and putting the same bytes again stores nothing new and answers the same
id — with the content type stored the first time. An id that is not 64 lowercase hex
digits is a 422. A *new* asset past `WYSEBEE_ASSET_MAX_COUNT` is a 409 saying so (one
already stored can still be put again); one person's puts take a lock, so two at once
cannot both slip under the cap. SVG is not accepted: it can carry script.

Rows are in `cloud_assets` (user, id, content type, size, created at); the bytes are named
`<user id>/<id>`, the user id being the token's `sub` as it is (`auth0|…`,
`google-oauth2|…`), so one person's assets are one folder named for them. A user id that is
not a single safe path segment (it holds `/`, `\`, `..`, a leading `.` or other characters
than letters, digits and `|@+=:._-`) cannot store assets: `PUT` is a 422. They are kept by one of two stores (`apps/cloud/asset_storage.py`,
behind an `AssetStore` interface), chosen by `WYSEBEE_ASSET_STORE`: **`file`**
(default; local dev and compose), a file under `WYSEBEE_ASSET_DIR` written to a temporary
name and renamed into place, or **`azure`** (production), one block blob each, uploaded in
one request with its content type, signed in with the app's managed identity. The bytes are
written before the row, and a delete removes the row before the bytes (best effort, logged
when it fails), so a failure can leave a stray file but never a row naming nothing.

| Setting | Default | |
|---|---|---|
| `WYSEBEE_ASSET_STORE` | `file` | `file` or `azure` |
| `WYSEBEE_ASSET_DIR` | `./data/assets` | `file`: where assets are written. Compose: the `assets` volume at `/data/assets` |
| `WYSEBEE_STORAGE_AZURE_ACCOUNT_URL` | — | `azure`: the Azure Blob Storage account every file store uses — assets, skill files and workspaces — `https://<account>.blob.core.windows.net`. Also read from `WYSEBEE_BACKUP_AZURE_ACCOUNT_URL`, the name deployments set while desktop backups were kept here (until migration 0062) and still set today |
| `WYSEBEE_ASSET_AZURE_ACCOUNT_URL` | `WYSEBEE_STORAGE_AZURE_ACCOUNT_URL` | `azure`: another account for all three stores. With neither set the app will not start |
| `WYSEBEE_ASSET_AZURE_CONTAINER` | `user-assets` | `azure`: the container |
| `WYSEBEE_ASSET_MAX_BYTES` | `1048576` (1 MiB) | The largest asset |
| `WYSEBEE_ASSET_MAX_COUNT` | `100` | Assets one person may keep |

## Skill files

A skill is a folder — a `SKILL.md` and whatever it needs, scripts included. **Since migration
0060 (2026-11-15) skills have tables of their own** (`apps/cloud/skills.py`):

- `user_skills` — one row per skill: `skill_id` (a UUID, what everything links by, so a skill
  can be **renamed**), its owner `user_id`, `name` (unique per owner), `description`, `files`
  (`[{path, id, size}]`) and `folders` (the folders made that hold no file yet, migration 0067);
- `agent_skills` — which agents have which skills, in order: the agent by its owner and its
  `agent_id` ([Agents](#agents); by its cloud item's `item_id` until migration 0063), the skill
  by `skill_id` (deleting either deletes the link). The agent's owner and the skill's are kept apart so a
  skill can later be shared with another person.

Before that a skill was a cloud item of kind `skill` keyed by its name, and an agent named its
skills in its settings' `skills`. 0060 copied them into the tables and deleted the items. A
paired Mac's poll still carries
`skills: [{name, files}]`, worked out from the tables (a renamed skill comes by its new name,
which the Mac asks to allow again).

| Route | |
|---|---|
| `GET /api/v1/skills` | `{skills: [{id, name, description, files, folders, created_at, updated_at, created_by, updated_by}]}`, by name |
| `POST /api/v1/skills` | `{name, description?, instructions?}` → 201 the skill, its `SKILL.md` made of them (a starter when not given); a taken name is a 409; at most 100 skills |
| `GET\|PUT\|DELETE /api/v1/skills/{id}` | Read, rename (`{name}`: its `SKILL.md`'s `name` too) or delete one. A delete deletes the stored files none of the person's skills has any more |
| `GET /api/v1/skills/{id}/files/{path}` | `{path, content, size}`; a file that is not UTF-8 text is a 422 (download it by its id) |
| `PUT /api/v1/skills/{id}/files/{path}` | `{content}` as JSON, or the file's bytes (an upload): written, its folders made with it → the skill. `SKILL.md` is read as the Mac reads it (a 422 says why not) and gives the skill its description; its `name` is the skill's. A name that looks like a secret is refused; over 5 MB 413; at most 200 files; no two files equal but for case, no file where a folder is |
| `DELETE /api/v1/skills/{id}/files/{path}` | 204; its folder stays. `SKILL.md` cannot go |
| `POST`/`DELETE /api/v1/skills/{id}/folders/{path}` | 201 the skill / 204, with all it holds |
| `GET /api/v1/skills/{id}/agents` | `{agents: [{id, name, label}]}`: the person's agents that have it, by name (the Skills page's overview) |
| `GET /api/v1/agents/{agent_id}/skills` | The agent's skills in its order |
| `PUT /api/v1/agents/{agent_id}/skills` | `{skill_ids}`: replaces them (at most 50, each the caller's) |

Another person's skill or agent is a 404, as is a deleted agent. A Mac paired with an agent is
woken when its skills, or one of them, change.

**The Skills page** (2026-11-17, `apps/cloud/skill_folders.py`): the website edits a skill a
file at a time, as Workspaces — a **Skills** item under More on the rail, each skill's folder
tree beside it (New file, New folder, Upload files…, rename, delete), and the same editor, with
Wysebee Assistant on the open file (`/api/v1/skills/{id}/assistant`, as a workspace's). A new
skill starts with its `SKILL.md`; scripts are written there or uploaded. An agent's Skills tab
only chooses which skills it has. Every change wakes the Macs that have the skill and the
person's open pages (the change feed). Wysebee Assistant also lets the AI app make a skill and
fill it: [Wysebee Assistant](#wysebee-assistant-your-ai-app-writes-the-open-page). The files count on the person's
**Storage** (below). Their bytes are kept here (`apps/cloud/skill_files.py`, table
`cloud_skill_files`, migration 0027):

| Route | |
|---|---|
| `PUT /api/v1/skill-files` | The body is the file's bytes, any content (`Content-Type` ignored; stored as `application/octet-stream`). Empty is 422, over `WYSEBEE_SKILL_FILE_MAX_BYTES` 413, a new one past `WYSEBEE_SKILL_FILE_MAX_COUNT` 409. Content-addressed. Answers `{"id", "size"}` |
| `GET /api/v1/skill-files/{id}` | The bytes as `application/octet-stream`, `Content-Disposition: attachment`, `nosniff`, cached for good |
| `DELETE /api/v1/skill-files/{id}` | 204, or 404 |

Signed-in callers only; another person's file is a 404, a bad id a 422. They are kept like
assets — the same `WYSEBEE_ASSET_STORE` kind and Azure account (the app's managed identity
needs its role on this container too) — in a store of their own:

| Setting | Default | |
|---|---|---|
| `WYSEBEE_SKILL_FILE_DIR` | `./data/user-skills` | `file`: where they are written. Compose: the `user-skills` volume |
| `WYSEBEE_SKILL_FILE_AZURE_CONTAINER` | `user-skills` | `azure`: the container — **create it before deploying** |
| `WYSEBEE_SKILL_FILE_MAX_BYTES` | `5242880` (5 MiB) | The largest file |
| `WYSEBEE_SKILL_FILE_MAX_COUNT` | `5000` | Files one person may keep |

## Workspaces

**Added 2026-11-14** (`apps/cloud/workspaces.py`, `apps/cloud/workspace_storage.py`): the
**Workspaces** page — the person's documentation, a folder of text files per
workspace. A workspace is a row of **`user_workspaces`** (`workspace_id` a UUID, `user_id`, `name` —
unique per person whatever its case — `resource_url`, timestamps; migration 0073, Projects
until then) and a folder in the workspace store, provisioned per person by their user id as skill
files are: **`<user id>/<workspace id>/<path>`**. Everything links by id, so **a workspace can be
renamed** and no file moves.
Unlike skill files, a workspace's files are **named by
their path** and have **no row each**: the folder structure is the store's own listing, and
an empty folder holds an empty `.keep`. Starting a workspace writes its `README.md`.
`resource_url` is the folder's URL in the container. Deleting the account deletes the
folders. Workspace files are **not counted** on Storage (it sums rows' sizes).

**On the website** (`ui/app`: a Workspaces item on the rail, the menu beside it
with each workspace's folder structure, the editor). Its in-browser gateway passes every
`/api/v1/workspaces…` request straight up to these routes (`ui/app/src/cloud/forward.ts`), a
file's path included.

| Route | |
|---|---|
| `GET /api/v1/workspaces` | `{"workspaces": [{id, name, resource_url, created_at, updated_at}]}`, by name |
| `POST /api/v1/workspaces` | `{"name"}` → 201 the workspace; a name taken (any case) or past `WYSEBEE_WORKSPACE_MAX_COUNT` 409, a bad one 422 |
| `GET /api/v1/workspaces/{id}` | The workspace with `files: [{path, size, updated_at}]` and `folders: [path]` |
| `PUT /api/v1/workspaces/{id}` | `{"name"}` → the workspace, renamed (the name's rules; a name taken, any case, 409). Its files stay where they are |
| `DELETE /api/v1/workspaces/{id}` | 204; the row, then its folder (best effort) |
| `GET /api/v1/workspaces/{id}/files/{path}` | `{path, content, size}` (UTF-8 text; a file that is not is 422) |
| `PUT /api/v1/workspaces/{id}/files/{path}` | `{"content"}` → `{path, size}`; over `WYSEBEE_WORKSPACE_FILE_MAX_BYTES` 413, a new file past `WYSEBEE_WORKSPACE_MAX_FILES` 409, a file where a folder is (or the reverse) 409 |
| `DELETE /api/v1/workspaces/{id}/files/{path}` | 204; its folder stays |
| `POST`/`DELETE /api/v1/workspaces/{id}/folders/{path}` | 201 `{path}` / 204, with all it holds |

Names and path segments: letters, digits, spaces, `-`, `_`, `.`, starting with a letter or
digit and not ending in a space or a dot; ten folders deep and 400 characters at most.
Signed-in callers only; another person's workspace is a 404. Kept like assets — the same
`WYSEBEE_ASSET_STORE` kind and Azure account — in a store of their own:

| Setting | Default | |
|---|---|---|
| `WYSEBEE_WORKSPACE_DIR` | `./data/user-workspaces` | `file`: where they are written |
| `WYSEBEE_WORKSPACE_AZURE_CONTAINER` | `user-workspaces` | `azure`: the container — **create it before deploying**, with the app's role on it |
| `WYSEBEE_WORKSPACE_FILE_MAX_BYTES` | `1048576` (1 MiB) | The largest file |
| `WYSEBEE_WORKSPACE_MAX_FILES` | `1000` | Files one workspace may hold |
| `WYSEBEE_WORKSPACE_MAX_COUNT` | `50` | Workspaces one person may have |

### Wysebee Assistant: your AI app writes the open page

**Added 2026-11-14** (`apps/cloud/workspace_assistant.py`, `ui/app/src/components/WriteWithAi.tsx`).
**It is always on for the page open in the editor** (2026-11-15: no switch): the editor takes it
when a page loads, and takes it back when the person returns to its window (or presses **Use
here**) after a page opened elsewhere took it. Beside the page's title, the **Wysebee Assistant**
badge has an info button whose panel says how to use it (in the AI app, ask it to write the page)
and how to add it, with the address to copy; there is no status line. A row of **`workspace_assistants`**
(one per person, so a page opened elsewhere moves it; migration 0053) holds the page and its
text **as the editor holds it**, with a revision every write bumps. The AI app reaches it
through Wysebee Assistant, `https://app.wysebee.com/assistant/mcp`
([Connect AI app](#connect-ai-app-every-agent-in-your-own-ai-app-through-wysebee-assistant-assistantmcp):
added once, signed in with Auth0), and its page tools — `read_document`, `write_document`, `append_to_document`,
`replace_in_document`, `list_workspace_files`, `read_workspace_file` — reach only that person's
open page and its workspace. **What it writes goes into the editor, not the saved file**: the
editor's long poll brings it in at once, and the person reviews it and saves. Off (or the
editor not heard from for `WYSEBEE_WORKSPACE_ASSISTANT_IDLE_SECONDS`, 60), every tool says so.

**A skill's file too** (2026-11-17, migration 0067): the Skills page's editor takes Wysebee
Assistant the same way, at `/api/v1/skills/{id}/assistant` (the routes below, under the skill).
For skills the AI app also has **`create_skill`** `{name, description, instructions?}` — a new
skill, its `SKILL.md` opened in the person's editor: an editor open on another page hears it
on its poll (`{on: false, opened: {skill_id, path}}`) and goes there — and, on the skill whose
file is open (the editor need not still be heard from), **`list_skill_files`**,
**`read_skill_file`**, **`write_skill_file`** `{path, content}` (a script or other file, made
or replaced; not the open file, which the page tools change for the person to save) and
**`add_skill_folder`** `{path}`. What these write is **saved at once**. On a skill's page,
`list_workspace_files` and `read_workspace_file` say to use the skill tools.

The same connector reaches every agent's tools (`list_agents`, `list_agent_tools`,
`call_agent_read_tool`, `call_agent_tool`), whether or not a page is open.

| Route | |
|---|---|
| `POST /api/v1/workspaces/{id}/assistant` | `{path, content}` → on for this page; the state `{on, url, path, revision, writer, content, ai_client, ai_seen_at}` |
| `GET /api/v1/workspaces/{id}/assistant?path=&after=&wait=` | Long poll: at once when the revision is past `after` (with the text) or the AI app's connection changed, else after `wait` s (≤ `WYSEBEE_WORKSPACE_ASSISTANT_WAIT_SECONDS`, 20); `{on: false}` when it is off for this page |
| `PUT /api/v1/workspaces/{id}/assistant` | `{path, content, revision}`: the person's edits → `{revision}`; 409 `detail: {message, …state}` when the AI app wrote since (or it is off) |
| `DELETE /api/v1/workspaces/{id}/assistant` | 204, off |

An AI write `pg_notify`s the relay channel with the person's key, so the long poll wakes on any
replica. The page tools are off with `WYSEBEE_MCP_ENABLED=false`, as all of `/assistant/mcp`.

**Trying it locally from Claude or ChatGPT**: their servers cannot reach `localhost`, nor the
mock sign-in. With `WYSEBEE_AUTH_MOCK=true`, set `WYSEBEE_ASSISTANT_MCP_LOCAL_USER` to the
mock person you sign in as (e.g. `mock|dev@wysebee.local`) and `WYSEBEE_PUBLIC_URL` to the
tunnel's address, run `./scripts/ngrok.sh`, and add `<tunnel>/assistant/mcp` to the AI app
with no authentication: `/assistant/mcp` then answers without sign-in, as that person. The
setting is refused at start without mock sign-in, so Dev and Prod always sign in with Auth0.

### Making a page directly

**Added 2026-11-27** (`apps/cloud/workspace_pages.py`, migration 0085). A page need not be made
from a document: **New page** (the workspace's overview, or a folder's + in the menu) makes a
`.html` file from a small starter, and **New document** makes markdown as before. A `.html` file
opens on its **Page** — shown as an AI-made page is, sandboxed with no network — with **Source**
beside it to edit its HTML; Wysebee Assistant writes it with `write_document` (`write_page`
refuses a `.html` file). Each save keeps its page (`workspace_pages.kind = "file"`, its title the
file's `<title>`), with a new view address and its public address, if shared, kept. Deleting the
file, or its folder, deletes the page; `DELETE /api/v1/pages/{id}` answers 409 for one.

### Sharing a page with everyone

**Added 2026-11-25** (`apps/cloud/workspace_pages.py`, `ui/app/src/components/PageShareDialog.tsx`,
migration 0084). A page the AI app made from a document (`write_page`) can be shared from the
editor's Page view → **Share** → **Anyone with the link**: anyone who opens its public address,
`<share domain>/s/<key>`, sees it with no sign-in. The key is random and kept when the AI app
writes the page again, so the address always shows the page as it is now; **Only you** drops
it (the address stops working), and sharing again makes a new one. Friends and colleagues are
to come (`audience` takes `"public"` only for now).

It is served as the in-app view is — sandboxed, no network, no forms — and framed by nobody,
with `X-Robots-Tag: noindex`.

**Who may share** is the policy's `may_share` (2026-11-27; see Extensions — on the hosted
service, not the Free plan). Refused, `PUT …/share` answers the refusal (e.g. 402 with its
sentence and `billing_url`), `GET /api/v1/pages/{id}` carries it as `share_refusal` — the dialog
says why, links to Billing and offers **Only you** alone — and a page shared before is a 404 at
its address until the person may share again. With no extension, everyone may.

| Route | |
|---|---|
| `PUT /api/v1/pages/{id}/share` | `{"audience": "public"}` → `{audience, url, shared_at}`; already shared, the same address; the policy's refusal when it says no |
| `DELETE /api/v1/pages/{id}/share` | 204: only its owner sees it again |
| `GET /s/{key}` | The page, for anyone — on the share domain only, when there is one |

**The share domain** (`WYSEBEE_SHARE_URL`, e.g. `https://wysebee.io`): what people make is served
from a domain apart from Wysebee's, so that a page reported as phishing gets that domain flagged
and not `app.wysebee.com`, and a page that ever slipped its sandbox would run with no Wysebee origin,
token or cookie within reach. With it set, the server answers on that host with `/s/<key>`,
`robots.txt` (`Disallow: /`) and its root (a 308 to `WYSEBEE_PUBLIC_URL`) only — every other
path there is a 404 — and `/s/` is a 404 on Wysebee's own host. The host is read from
`X-Forwarded-Host`, else `Host`. Unset (local development, self-hosted), pages are shared from
this site. It must be an origin only, and not `WYSEBEE_PUBLIC_URL`'s host.

## Activity: your agents' notifications

**Every agent has `send_notification`** (`{title, body?}`: one line of at most 200 characters,
and Markdown of at most 10,000), offered with its own tools, so a notification is always from
an agent: the AI app runs it with `call_agent_tool` (`{agent, tool: "send_notification",
arguments}`), and a scheduled task can run it as one of its steps. Each one is kept in
`user_notifications` (migration 0055; its agent since 0056, by id since 0063 — answered as
its handle now, `null` once it is deleted; a person's newest 500) and shown on
the website's **Activity** page (on the rail below Agents), newest first, with the agent's
picture and name. Each one costs a credit, like any tool call answered. (A due task also posts
its own notification, from its first step's agent.)

**Browser notifications**: a switch on the Activity page asks the browser for permission and is
remembered in that browser. While it is on, a new notification shows as a system notification
when the Wysebee tab is not in front, named for its agent; clicking it opens Activity. Each one's
id is its tag, so two open tabs show it once.

- `GET /api/v1/notifications?limit=` — `{notifications: [{id, title, body, agent, created_at, read}], unread}`.
- `GET /api/v1/notifications/unread` — `{unread}`, for the rail's badge.
- `POST /api/v1/notifications/read` — opening Activity reads them all: `{read: n}`.
- `DELETE /api/v1/notifications/{id}` — one deleted (the trash button on each in Activity): 204,
  or 404 when the person has none such.

**Live, with no polling**: a new one (or reading them) `pg_notify`s the change feed, whose
open streams send `event: activity` with the new unread count (apps/cloud/config_events.py);
the badge follows it at once.

## Scheduled tasks: reminders and periodic work, run by Wysebee Cloud

When the person asks their AI app for a reminder or for something done on a schedule, the AI
app sets up a **task** through Wysebee Assistant: `save_task` (`{id?, name, plan?, schedule?,
steps?}`), `list_tasks` (free), `run_task` and `delete_task` (apps/cloud/task_runner.py).
Wysebee Cloud has no model, so when a task is due it does exactly this:

1. runs each **step** in order — an agent's tool (`{agent, tool, arguments}`, at most 10; the
   AI app names the agent by its handle, and the step keeps it by id, `{agent_id, tool,
   arguments}`, so renaming the agent keeps the step), as `call_agent_tool` runs it, each
   answered step a credit;
2. posts the **plan** with what each step returned to the person's **Activity**, from the
   first step's agent (a reminder is a plan and a schedule with no steps);
3. records a run with the task's runs (the website's Run tab) and works out when it is next due.

A schedule is `{type: "manual"}`, `{type: "once", at}`, `{type: "recurring", repeat:
"minutes" | "hours", every}` or `{type: "recurring", repeat: "daily" | "weekly", time:
"HH:MM", tz, days?}` (`tz` an IANA zone; `days` 1 = Monday). When each task is next due is kept
in `task_schedules` (migration 0057) from every save of the task, from the website or the AI
app ([Tasks](#tasks)). Every `WYSEBEE_TASK_TICK_SECONDS` (20) each replica claims the due
ones with `FOR UPDATE SKIP LOCKED`, so a task runs once; a run whose replica died is claimed
again after `WYSEBEE_TASK_RUN_STALE_SECONDS` (900). A run that fails outright is tried again
five minutes later. `GET /api/v1/task-schedules` — `{schedules: {task_id: next_run_at}}` — is
how the website shows the next run. A task's page shows its schedule and steps; they are set up
and changed from the AI app.

## Extensions

**What a deployment adds that is not in this repository** — the hosted service's plans and
payments are one, in a private package — is an **extension** (`apps/cloud/extensions.py`): a
Python module named in `WYSEBEE_EXTENSIONS` (comma-separated) whose `register(settings)`
returns an `Extension`. None named, the server is as this repository has it: everything
allowed, no limits, no Billing page.

| Setting | Default | |
|---|---|---|
| `WYSEBEE_EXTENSIONS` | — | The extension modules to load, in order (importable from the server's environment) |

An extension may give:

- **a policy** (`Policy`) — asked where the server decides what a person may do:
  `may_use` (every route of theirs but their account and usage — `require_access` on the
  routers in `apps/cloud/main.py` — Wysebee Assistant's tools, a scheduled task's run),
  `may_pair` (pairing a device; the code stays good after a refusal), `may_call` (each call to
  a device), `may_share` (sharing a page publicly, and opening one shared; API 3, 2026-11-27)
  and `storage_quota`. A refusal is a `Refusal(status, code, detail, more)`, answered
  `{"detail", "code", ...more}` (to an AI app: the sentence). The last extension with a policy
  decides; the default refuses nothing.
- **routes**, served under `/api`;
- **migrations**: its own Alembic folder, whose `env.py` keeps its own version table, run after
  this repository's by `python -m apps.cloud.extensions migrate` (`scripts/start.sh`);
- **account deletion hooks**: `before_account_delete` (may refuse; nothing is deleted then) and
  `on_account_erase` (in the erasing transaction, for its own tables);
- **web features**: `GET /api/v1/web/config` `features.billing` — the pages then show Account →
  Billing (from the extension's `GET /api/v1/plan` and `/api/v1/billing`) and, while `/plan`
  says `allowed: false`, only it.

What a policy may read is the server's own: its models, its settings, and the usage it counts —
devices (`browser_links.device_counts`: registered, and online now), relay traffic and tool
calls (below). **The interface is versioned** (`extensions.API`): an extension built for
another version is refused when the app starts.

**Agent types as packs** (built 2026-11-21: the interface and registry, `apps/cloud/agent_packs.py`,
the browser's, the phone's and the computers' packs, `apps/cloud/packs/`, and their settings served by
`GET /api/v1/agent-types`; a new kind needs no core change — the design's "Adding a kind of device"; an extension's `agent_types`): each kind of device's server side as one module the core asks — [docs/agent-type-packs.md](docs/agent-type-packs.md). The device link protocols
are in [docs/protocol/](docs/protocol/README.md).

### Relay traffic, counted per person and month

**Each person's relay traffic is counted** (2026-11-21, `apps/cloud/traffic.py`, table
`relay_traffic`, migration 0083): the bytes between their AI app and their devices through
Wysebee Cloud — a call's arguments, its result, a skill file a Mac downloads, a recording a
browser uploads — per calendar month (UTC), by one upsert, so a new month starts at 0. A
statistic here; an extension's policy may limit it. Counting is best effort (a failed write logs
`relay_traffic_count_failed`).

### Tool calls, counted per person and month

**Each person's tool calls are counted** (2026-11-03, `apps/cloud/tool_calls.py`, table
`ai_turn_counts`, migration 0032) — **a statistic, no limit** here (credits, with an allowance, until 2026-11-21). **One is one tool call answered through Wysebee Assistant**: an agent's tool run by
`call_agent_tool`, a page tool, or a scheduled task's step. `list_agents` and
`list_agent_tools` are not counted; a call refused, failed or timed out is not counted. **Per
calendar month, UTC**: one row per person and month (`YYYY-MM`), added to by one upsert, so a
new month starts at 0 on the 1st at 00:00 UTC and earlier months stay as history. Counting is
best effort — a write that fails logs `tool_call_count_failed` and the tool's answer still goes
out.

| Route | |
|---|---|
| `GET /api/v1/tool-calls` (`/api/v1/ai-turns` until 2026-11-14) | `{month, count, resets_at, billing_url}`: the signed-in person's this month, when the count starts over (the next month's 1st, 00:00 UTC), and the website's Billing page (`<public_url>/app/#/account/billing`; null unless an extension serves one) |

### Storage, measured per person

**Each person's file storage is shown against a quota** (2026-11-11, `apps/cloud/storage.py`),
on the website's Account → Billing. **What counts is their pictures** (`cloud_assets`, the
`user-assets` container), **their skills' files** (`cloud_skill_files`, `user-skills`) and
**their browser recordings** (`browser_recordings`); desktop backups were another kind until
migration 0062. Each such file has a row with its size, so the total is sums in the database;
the blob store is never listed. Workspace files are not counted. What lives in the database
itself (conversations, settings, tasks) is not counted. **The quota** is `WYSEBEE_STORAGE_QUOTA_BYTES` (1 GiB by
default; 100 GiB self-hosted), or more where an extension's policy gives it
([Extensions](#extensions)). It is enforced on recordings only (a device sends those); each store still has its own per-file and
per-count limits.

| Route | |
|---|---|
| `GET /api/v1/storage` | `{used, limit, files, parts: [{kind, bytes, files}]}`: the signed-in person's bytes and files, in all and per kind (`assets`, `skill_files`, `recordings`) |

## Agents living in Wysebee Cloud

An agent's tools run here for the person's own AI app, through Wysebee Assistant
(`apps/cloud/agent_chat/toolbox.py`, called by `apps/cloud/agent_mcp.py`): **its skills,
read-only** (`load_skill`, `skill_read_file` over the skill items and files above) **and its
PostgreSQL and Snowflake connections kept here** (below) — and, for an agent made by pairing
the Wysebee Agent browser extension, **that one browser**
([The browser link](#the-browser-link-apiv1browser-links)) — and, for an agent made by pairing
Wysebee Agent for Mac, **that Mac's programs, skill scripts and folders, run on that Mac**
([A Mac agent living in Wysebee Cloud](#a-mac-agent-living-in-wysebee-cloud-2026-11-13)).
Nothing runs on this server itself. (Until 2026-11-14 the cloud also ran a chat with the agent,
with its own AI model; that went with chat.)

**The key-encryption key** (`apps/cloud/envelope.py`) seals the PostgreSQL passwords below:
each is AES-256-GCM under a data key of its own, which is stored only wrapped by a key that is
**never in the database** — an RSA key in **Azure Key Vault** in production (wrapped and
unwrapped by the vault, RSA-OAEP-256, as the app's managed identity), or a local 32-byte key
for development. (It first sealed the person's own AI keys, hence its name.)

| Setting | Default | |
|---|---|---|
| `WYSEBEE_AI_KEK_VAULT_KEY_URL` | — | Production: `https://<vault>.vault.azure.net/keys/<name>`, an RSA key. The app's managed identity needs **Key Vault Crypto User** on it (wrap/unwrap only). Rotating it keeps older rows readable while their version stays enabled |
| `WYSEBEE_AI_KEK` | — | Development only: 32 bytes, base64 (`python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`). Compose sets one |

**Tools** (2026-11-15, `apps/cloud/user_tools.py`, tables `user_tools` and `agent_tools`,
migration 0061): as skills, a person's reusable tools are a library, each with an id
(`tool_id`, so it can be renamed) and a name unique per kind, given to agents through
`agent_tools` (the agent by its `agent_id` — its cloud item's `item_id` until migration 0063 —
the tool by id, in order; deleting either deletes the link). The agent's owner and the tool's are kept
apart so tools can later be shared. The kinds:

- **`postgres`** — a connection (`config`: `host`, `port`, `database`, `user`, `ssl`,
  `changes`). The agent gets `postgres_schema` and `postgres_query`
  (`apps/cloud/agent_chat/postgres.py`): read only unless the
  connection allows changes, one statement a call, 30 s a statement and 45 s a call, 200 rows,
  every value as text. Running them on its own network, the cloud allows **only public
  addresses** — the host is looked up and refused if any address it has is loopback, private,
  link-local (the metadata address), shared or reserved, and the connection goes to the very
  address checked (`hostaddr`), the name kept for the certificate; **TLS always** (`verify`,
  the default, checks the certificate against the system's roots; `require` only encrypts —
  never in the clear); and **60 calls a minute** for each person, on each replica.
- **`snowflake`** — a connection (`config`: `account`, `database`, `warehouse`, `schema`,
  `role`, `user`, `auth` — `token`, a programmatic access token, or `key`, an unencrypted RSA
  private key that signs a ten-minute JWT per call — and `changes`). The agent gets
  `snowflake_schema` and `snowflake_query` (`apps/cloud/agent_chat/snowflake.py`): one
  statement a call to `https://<account>.snowflakecomputing.com/api/v2/statements` and nowhere
  else, read only unless the connection allows changes (only SELECT, WITH, SHOW, DESCRIBE,
  EXPLAIN are sent), at most 200 rows, 60 calls a minute a person. No plan is asked.
- **`gmail`, `calendar`, `travel`, `news`, `website`** — a site link (`config` `{address}`, the
  address also its name; `description` what it is for). Only an agent made by pairing the
  browser extension may be given one (the agent types' `tool_kinds`).
- **`program`** — a program on a Mac (`config` `{command, args}`, its tool `local_<name>`). Only
  a Mac's agent may be given one; its Mac's poll carries the agent's programs and hears at once
  when they change.

A connection's password, token or key (`secret`) is envelope-encrypted (above) and
**write-only** (`has_secret` says only whether one is kept): left out, a save keeps it; `""`
removes it. It is bound to `<kind>:<tool_id>`; one copied by 0061 keeps the binding it was
sealed with (`secret_aad`) until it is next saved.

| Route | |
|---|---|
| `GET /api/v1/tools?kind=` | `{tools: [{id, kind, name, description, config, has_secret, created_at, updated_at}]}` |
| `POST /api/v1/tools` | `{kind, name, description, config, secret?}` → 201; a taken name is a 409; at most 500 |
| `GET\|PUT\|DELETE /api/v1/tools/{id}` | Read, change (renaming it too; not its kind) or delete one |
| `POST /api/v1/tools/test` | `{kind, name, description, config, secret?, tool_id?}` → `{ok, version, error}`: a connection tried with the secret typed, else the stored one; nothing saved |
| `GET /api/v1/agents/{agent_id}/tools` | The agent's tools, by kind and in its order |
| `PUT /api/v1/agents/{agent_id}/tools` | `{kind, tool_ids}`: replaces the agent's tools of that kind (ten connections, twenty links or programs of a kind at most). Giving one its type may not have is a 422 `wrong_agent_kind`; keeping or taking one never is |

**Before 0061** connections were the tables `cloud_postgres` (0029) and `cloud_snowflake`
(0042), keyed by the agent's name, at `/api/v1/postgres/{agent}/{name}` and
`/api/v1/snowflake/{agent}/{name}`; site links and a Mac agent's programs were its settings'
`gmail_accounts`, `calendar_sites`, `travel_sites`, `news_sites`, `websites` and
`local_programs`. 0061 copied them into tools (a taken name gets `_2`…; the same link or
program on several agents one tool) and a save now drops those fields. A desktop agent's own
connections and programs (`postgres_databases`, `snowflake_databases`, `local_programs`, with
their passwords in `user_credentials`) were not copied; migration 0062 dropped them.

**The API for each agent** (`/api/v1/agents/{agent}/chat`, its keys at `/api/v1/agent-keys`)
went with chat on 2026-11-14; migration 0063 dropped its table, `cloud_agent_keys`.

## The browser link (`/api/v1/browser-links`)

**Decided 2026-11-11, the person's calls**: the **Wysebee Agent** browser extension pairs
**with Wysebee Cloud only** — no native messaging, no loopback socket. The extension shows a
code; the person types it on the website, signed in; **pairing creates a new agent** (or, since
2026-11-13, gives the browser back to the person's agent of its kind that has none: below), and
**only that agent drives that browser**. The contract is
[docs/protocol/browser-extension.md](docs/protocol/browser-extension.md) — the extension and this server
(`apps/cloud/browser_links.py`) are each built against it, and **a change there is a change in
both**.

Errors are `{"detail": "<English sentence>", "code": "<code>"}`. The extension's own routes
take `Authorization: Bearer <secret>` — a secret it made, of which only the SHA-256 (of the
text as sent) is kept, compared in constant time; the others take the person's sign-in and
see only that account's links: another's is a 404.

| Route | Who | |
|---|---|---|
| `POST /api/v1/browser-links/start` | extension, **no auth** | `{name, secret_hash, browser?, extension_version?}` → `{id, code, expires_in}`: a link nobody owns yet, and the 8-character code to show (`XXXX-XXXX`). 422 `invalid_name` / `invalid_hash`; 429 `too_many_starts` (10 a minute from one address, or 10 codes from it still waiting: only the address's SHA-256 is kept, until claimed, migration 0080); 503 `busy` (2,000 waiting in all) |
| `POST /api/v1/browser-links/{id}/poll?wait=` | extension | `{status: {paused, extension_version, browser}}` → `{state: "pending", expires_in}`, `{state: "refused", reason, message}` or `{state: "paired", agent, calls: [{id, op, args}], cancelled: [id]}` — at once when there is something to say, else after `wait` (25 s at most). 401 `unpaired` (the link is gone, its agent is, or the secret is not its own), 410 `expired`. Every poll of a paired link marks it connected |
| `POST /api/v1/browser-links/{id}/calls/{call}/result` | extension | `{ok: true, result}` or `{ok: false, error}` → 204; 16 MB at most (413, and the call fails); 404 `call_gone` for a call cancelled, out of time or expired |
| `DELETE /api/v1/browser-links/{id}` | extension | Unpair itself (also while its code is still waiting) → 204. Its agent stays, without a browser |
| `POST /api/v1/browser-links/claim` | person | `{code, name?, reconnect?}` → `{link, agent: {name, label}}`: the link is theirs and its agent is made, or reconnected. 404 `code_unknown`, 422 `invalid_name` / `reserved`, 409 `name_taken` (`{detail, code, agent: {name, label}, reconnect}`) / `too_many`, 429 `too_many_tries`; **a refusal for the name keeps the code good** |
| `POST /api/v1/browser-links/offers` | person | → `{id, token, expires_in}`: a pairing for a phone to scan as a QR code (2026-11-17; `docs/protocol/android.md`). One use, ten minutes, at most five open; only the token's SHA-256 is kept (`agent_link_offers`, migration 0078). A device whose `/start` carries `offer` is claimed for this person at once (`{id, code: null, expires_in: 0, agent}`); a name refused frees the offer (`name_taken` saying whether `reconnect` may be asked, as for a code), 404 `offer_unknown` for one used, run out or unknown. `/start`'s `reconnect: true` with `offer` is not claimed at once (2026-11-18): it gets a code, which the person types in Wysebee and reconnects there |
| `GET /api/v1/browser-links/offers/{id}` | person | → `{state: waiting \| expired}` or `{state: paired, agent: {name, label}}`; 404 `offer_unknown` when it is not this person's |
| `GET /api/v1/browser-links` | person | `{links: [{id, agent_id, agent, label, browser, extension_version, status, paused, last_seen, created_at}]}` — `connected` while it polled within 45 s |
| `POST /api/v1/browser-links/{id}/unpair` | person | → 204. The extension's next poll is a 401; `browser_link` leaves the agent's settings |
| `POST /api/v1/browser-links/{id}/calls?wait=` | person | `{op, args, timeout_seconds?}` → `{id, status, ok?, result?, error?}`: when it is done, or after `wait` with how it stands. 404 `browser_unpaired`, 409 `browser_offline` |
| `GET /api/v1/browser-links/calls/{call}?wait=` | person | The same answer; a finished call is deleted once read |
| `POST /api/v1/browser-links/calls/{call}/cancel` | person | → 204; the extension is told on its next poll |

- **The claim makes the agent here** (a [`user_agents`](#agents) row, `name` the handle),
  through the agents' own write path — a revision and the change feed, so the person's open
  pages see it at once. The link holds the agent by id (`agent_id`, migration 0063): renaming
  the agent keeps it paired, deleting it deletes the link. The handle is made
  from the typed name (lowercase, every run of other characters a `-`, 30 at most, starting
  with a letter): not `wysebee`, not `pairing` or `camera`, not taken, 20
  agents at most. Its settings are `{label, browser_access: true, browser_link: <link id>,
  paired_kind: "wysebee-browser-chrome", agent_type_id}`. **It is online only while its browser is** (2026-11-13, the person's call): offline while the extension has not polled within `WYSEBEE_BROWSER_LINK_ONLINE_SECONDS` or is paused (`offline_reason`, shown on its Connect AI app tab), and the website shows it offline from `/api/v1/browser-links`. A link an older cloud
  refused keeps its reason, so the extension can say why; this one refuses no link
  (below).
- **A taken name is settled where the code is typed** (2026-11-13, the owner's call; the
  protocol's section of that name). A claim refused for the name — 422 `invalid_name` /
  `reserved`, 409 `name_taken` / `too_many` — **leaves the code good** until it runs out: the
  extension goes on showing it, its poll stays `pending`. `name_taken` says whose the name is
  (`agent: {name, label}`) and whether **`reconnect`** may be asked: only when that agent's
  `CONFIG.paired_kind` is this link's type's key **and no link holds it now** (an agent still
  paired, of another type, or with no `paired_kind` — a plain agent, or one unpaired before this —
  cannot be). The person claims again with the same code: with `name` (one line, 1-60, the
  start's rule — the handle and label are made from it instead of the device's), or with
  `reconnect: true`, which gives the link to the existing agent of that handle: its link field
  is written (for a Mac, `mac_folders` `[]` too), **nothing else of it changes** — label, chats,
  settings, tools — through the same write path (a revision, the change feed). A `reconnect`
  asked for a handle nobody has makes the agent as any claim does. The link takes the agent's
  label, so the device shows the agent it got. A Mac starts it as any pairing: nothing allowed
  there yet, folders picked again.
- **`paired_kind`** (the key of the agent type it was made for — `"browser"` / `"osx"` until
  agent types, migration 0050 — beside `agent_type_id`) is the type of device the agent was made for:
  set by the claim, **kept when it is unpaired** (unlike `browser_link` / `mac_link`), and
  **never set or cleared by a save** — `keep_link` writes the stored value whatever is sent,
  or, for an agent paired before it existed, its live link's kind (at its next save). A tool
  only that kind may have is checked by the link field, as before: an unpaired agent keeps
  what it had, and gets nothing more until it is reconnected (`tool_kinds.py`).
- **`browser_link` is set only by the claim.** Whatever an agent save sends, the cloud writes
  what the links table says — the link made for that agent, or none (`keep_link`, called by
  `agents.py`). Deleting the agent deletes its link; so does deleting the account
  (`account_deletion.py`: both tables carry `user_id`).
- **A call's status**: `waiting` (queued), `running` (the extension took it), `done` — the
  extension answered, `ok` saying whether the browser did it or refused, with `result` or
  `error` — or `failed`: the cloud gave up — not taken within 20 s (the browser could not be
  reached), not answered within its `timeout_seconds` (5–240, 60 unless said; the extension is
  then told to stop it), or a result too big.
- **Postgres is the queue**, with the listener hub and `NOTIFY` channel of
  `apps/cloud/relay.py`, named for the relay it once served (`bl:<link>` wakes that extension's
  poll, `bc:<call>` the driver waiting): any replica
  serves either side. Without `LISTEN` (`WYSEBEE_CONFIG_EVENTS_LISTEN=false`), waiters look
  again every second.
- **Agents living in Wysebee Cloud drive it too**, for the person's AI app: such an agent whose settings have
  `browser_link`, and `browser_access` not `false`, is offered the browser tools
  (`apps/cloud/agent_chat/browser.py`, over `agent_chat/data/browser_tools.json`, which **must
  match the ops the extension takes**) and, with `browser_devtools: true`,
  its web development tools. Each call goes through the same queue in process
  (`browser_links.run_op`), naming the agent: a link that is not that agent's own is refused.
  A screenshot's or snapshot's picture goes back to the AI app with the tool's text. No
  recording in the cloud.
- **What passes through, and how long it is kept.** Every call's arguments and result — page
  snapshots, screenshots — pass through this server and are in `browser_calls` until read, an
  hour at most (purged every `WYSEBEE_TURN_PURGE_SECONDS`). The extension's per-site
  approvals, pause switch and blocked request kinds are enforced in the extension, before
  anything is read. A pairing code nobody typed is deleted a code's time after it ran out.
- **`/start` takes no credential**, so it is bounded: small bodies (4 KB), codes that run out
  and are purged, a cap on links waiting for their code, and so many starts a minute from one
  address — counted **on each replica, in memory**, like the wrong codes an account may type
  (there is no shared rate limiter in this service).

Tables `browser_links` (id, `user_id` null until claimed, code and its expiry, `secret_hash`,
the typed name, the agent's handle, browser, extension version, paused, why a claim was
refused, created / claimed / last seen) and `browser_calls` (id, link, `user_id`, op, args,
status, ok, result, error, timeout, created / claimed / finished, and whether the extension
has yet to hear that it stopped) — **migration 0044; deploy it before the extension or
website that pairs.**

| Setting | Default | |
|---|---|---|
| `WYSEBEE_BROWSER_LINK_CODE_SECONDS` | 600 | How long a pairing code is good |
| `WYSEBEE_BROWSER_LINK_PENDING_MAX` | 2000 | Links that may wait for their code at once (then `/start` is 503 `busy`) |
| `WYSEBEE_BROWSER_LINK_STARTS_PER_MINUTE` | 10 | `/start` calls a minute from one address, on each replica (429) |
| `WYSEBEE_BROWSER_LINK_TRIES`, `…_TRY_WINDOW_SECONDS` | 10, 600 | Wrong codes an account may type in that window, on each replica (429 `too_many_tries`) |
| `WYSEBEE_BROWSER_LINK_ONLINE_SECONDS` | 45 | An extension that polled within this is connected; else a call is 409 `browser_offline` |
| `WYSEBEE_BROWSER_LINK_POLL_SECONDS`, `…_WAIT_SECONDS` | 25, 25 | The longest the extension's poll, and a driver's wait, are held |
| `WYSEBEE_BROWSER_LINK_CLAIM_SECONDS` | 20 | A call the extension has not taken by then fails |
| `WYSEBEE_BROWSER_LINK_CALL_SECONDS`, `…_CALL_MIN_SECONDS`, `…_CALL_MAX_SECONDS` | 60, 5, 240 | A call's `timeout_seconds`: the default and its bounds |
| `WYSEBEE_BROWSER_LINK_ARGS_MAX_BYTES`, `…_RESULT_MAX_BYTES` | 100000, 16000000 | A call's arguments, and a result's body |
| `WYSEBEE_BROWSER_LINK_KEEP_SECONDS` | 3600 | Calls not read by then are deleted |

### A second kind of link: Wysebee Agent for Mac (`/api/v1/agent-links`)

**Decided 2026-11-12, the person's calls**: "Run local program" tools
run through **Wysebee Agent for Mac**, an app of its own, which pairs with this cloud exactly
as the extension does. The link above became **one mechanism with two kinds** — `browser` (the
extension) and `osx` (the Mac app) — in the same tables and the same module. The contract is
[docs/protocol/computer.md](docs/protocol/computer.md), which builds on the extension's:
**a change there is a change here**.

- **Every route above is also served under `/api/v1/agent-links`** — the same handlers. A
  link of either kind is reached at either prefix; the extension keeps
  `/api/v1/browser-links`.
- **`POST /start` takes `kind`**: `"browser"` (the default) or `"osx"`; anything else is 422
  `invalid_kind`. For an `osx` link `browser` holds the Mac's name and `extension_version`
  the app's version.
- **`Link` gains `kind` and `approved`** — the names of the agent's programs that Mac has
  allowed, as it last said (`[]` for a browser).
- **The claim** is the browser's (the person need not know which kind a code is), a taken
  name settled the same way (2026-11-13: an `osx` agent with no Mac may be reconnected to a
  new Mac). For an `osx` link the new agent's `CONFIG` is `{label, mac_link: <link id>,
  mac_folders: [], paired_kind: "wysebee-osx", agent_type_id}` — no `browser_access`, no
  `browser_link`.
- **`mac_link` is set only by the claim**, like `browser_link`: on every agent save each of
  the two fields is what the links table says for that agent (`keep_link`). Unpairing (either
  side) takes the link's own field off the agent; deleting the agent, or the account, deletes
  the link.
- **The Mac's poll** may say `status.approved` (a list of at most 20 names of at most 40
  characters; anything else is ignored), kept on the link. Its `paired` answer also carries
  **`programs`**: the agent's `program` tools (`apps/cloud/user_tools.py`; at most 20, `[]`
  when there are none), each `{name, description, command, args}`. **A program changed,
  deleted, given or taken away wakes the poll** (`wake_for_agent` notifies `bl:<link>`), which
  answers at once.
- **Ops by kind**: a browser link takes the browser's ops, an `osx` link only `ping`,
  `skill_run`, `folder_call` (below) and `local_run` (`{name, values}` → `{exit_code, stdout, stderr}`; the driver gives it 75 s);
  the other kind's op is 422 `invalid_op`. This server's own agent loop sends them for a Mac
  agent living here (below).
- **Refusal codes are the browser's** (`browser_unpaired`, `browser_offline`, `unpaired`…),
  so a driver handles both kinds alike; the sentences speak of the Mac ("Wysebee Agent is not
  running on the Mac, or the Mac is asleep or offline.").
- **What passes through**: each call's blank values and the program's output, in
  `browser_calls` until read, an hour at most; and the program definitions, which are the
  agent's settings. The Mac runs only what the person allowed there, from its own copy.

`browser_links.kind` (`browser` unless said) and `browser_links.approved` (jsonb, `[]`) are
**migration 0045; deploy it before the Mac app.**

**Skill scripts** (2026-11-12, later the same day, the person's call; the Mac protocol's
"Skill scripts"): a skill's scripts **run only for an
agent made by pairing Wysebee Agent for Mac, and only on that Mac**. Any agent may still have
a skill that declares scripts, for its instructions and files.

- **The Mac's `paired` poll answer also carries `skills`**: the agent's skills
  (`agent_skills`, [Skill files](#skill-files)), in its order, at most 50, each by its current
  name as `{name, files: [{path, id, size}]}` (`_skills`). `SKILL.md` is one of the files: the
  Mac reads the declared scripts from it itself. A browser's poll has no `skills`.
- **The poll is woken when they change**: a skill changed or deleted, or the agent's skills
  given or taken away, notifies `bl:<link>` for the agent's `osx` link (`wake_for_skill`,
  `wake_for_agent`), and a waiting poll answers at once when its programs or skills changed.
- **The status body may say `approved_skills`** (at most 50 names of at most 40 characters;
  anything else is ignored), kept on the link; **`Link` gains `approved_skills`** (`[]` for a
  browser).
- **`GET /{id}/skill-files/{file id}`** (under both prefixes), with the Mac's own secret as for
  the poll (401 `unpaired` otherwise): the file's bytes, `application/octet-stream`, from the
  person's skill file store (`apps/cloud/skill_files.py`, their own namespace) — only when the
  link is an `osx` one, claimed, and the id is in the synced file list of a skill its agent
  has. Anything else — a browser's link, a Mac not paired yet, a skill the agent lacks,
  another account's file, a file not stored, not an id — is the same 404 `{"detail", "code":
  "file_unknown"}`. The Mac checks the bytes' SHA-256 against the id.
- **An `osx` link takes `skill_run` too** (`{skill, script, args}` → `{exit_code, stdout,
  stderr}`; the driver gives it 75 s); a browser's is 422 `invalid_op`. This server's own
  agent loop offers `skill_run_script` to a Mac agent living here (below); for any other agent
  it stays read-only for skills (`load_skill`, `skill_read_file`), and its prompt and
  `load_skill` say a skill's scripts run only for an agent made by pairing Wysebee Agent for Mac.
- The computer's pack lists `skill_scripts` among its tool kinds: a tag the apps show, **never refused**
  by the agent save check (`tool_kinds.py` has no entry for it).

`browser_links.approved_skills` (jsonb, `[]`) is **migration 0046; deploy it before a Mac app
that uses skill scripts.**

**Local folders** (2026-11-12, later again, the person's calls; the Mac protocol's "Local
folders"): **Local Folder is a Mac agent's only**. The person picks each folder in Wysebee
Agent for Mac, with its permission and a description; the cloud never holds a path the Mac
would act on.

- **The status body may say `folders`**: a list of `{id, name, path, mode, description}` —
  `id` 1–32 of `A-Za-z0-9_-`, `name` one line of 1–60 (trimmed), `path` at most 1,000 (shown
  only), `mode` `"read"` or `"write"`, `description` at most 1,000 (may be empty or left
  out). Malformed entries, and a second entry with an id already given, are dropped; the
  order is kept; at most 20. Not a list (or absent) keeps what is stored. A poll's body may
  now be 256 KiB (`POLL_BODY`; `/start` and `/claim` stay at 4 KiB). **`Link` gains
  `folders`** (`[]` for a browser).
- **When the list differs from what the link had, the cloud writes it into the agent's
  settings as `mac_folders`**, through the agents' write path (a revision, the change feed),
  in the poll's transaction — once per change, not
  on every poll (`_write_folders`). **`mac_folders` is set only by the cloud**: on every agent
  save `keep_link` pins it to what the agent's `osx` link holds, as it does `mac_link`; a
  browser's agent or a plain one has none, and unpairing takes it off with `mac_link`. A Mac's
  claim starts it as `[]`.
- **An `osx` link takes `folder_call` too** (`{tool, folder, args}` → `{text, picture?}`;
  the driver gives it 75 s); a browser's is 422 `invalid_op`. This server's own agent loop
  offers the folder tools to a Mac agent living here (below).
- **The old per-computer `folders` setting is gone**: an agent save drops it
  (`user_tools.GONE`), and migration 0062 took it out of every agent. The computer's pack lists
  `folder` under `osx`; the save check has no entry for it (`mac_folders` is the cloud's to
  set, so no save can add it).

`browser_links.folders` (jsonb, `[]`) is **migration 0047; deploy it before a Mac app that
uses local folders.**

### A Mac agent living in Wysebee Cloud (2026-11-13)

**Decided 2026-11-13, the owner's call** (the Mac protocol's "a Mac agent may live in Wysebee
Cloud"): **a Mac's code is typed on the website**, under Devices → **Pair a device** → **Pair a Mac** (the browser's
dialog; the claim does not care which kind a code is). The agent the claim makes lives in
Wysebee Cloud, and **this server runs that Mac's tools for it**, for the person's AI app
through Wysebee Assistant. Nothing
changes for the Mac app: the same link, ops, approval and limits.

- **Which tools** (`apps/cloud/agent_chat/mac.py`, the only copy of the tools' words): for an
  agent whose `mac_link`
  the links table holds as that agent's (`browser_links.paired_mac`) — `local_<name>` for each
  of its `program` tools → op `local_run` `{name, values}`; `skill_run_script` when one of its
  skills' `SKILL.md` declares a script → `skill_run` `{skill, script, args}`; `folder_find`,
  `folder_list`, `folder_read` and, with a read-and-write folder, `folder_write` over its
  `mac_folders`, numbered in the Mac's order → `folder_call` `{tool, folder: <the Mac's id> |
  null, args}`. Each through `run_op`, naming the agent, with `timeout_seconds` 75. An agent
  whose Mac was unpaired keeps its programs, offered none.
- **A Mac that is paused, asleep or offline is a tool error the AI app reads** (the link's
  refusal codes and Mac sentences, `browser_links.MAC`): the agent itself lives here, so —
  unlike a browser's — it is never offline for its Mac.
- **A folder tool's picture** is for the person alone: **never given to the AI app**
  (`apps/cloud/agent_mcp.py` says one was left out).
- **Set up on the website**: a Mac agent's programs are made, changed, given and taken away on
  its Tools tab (Run local program), saved at once as the person's tools; the Mac's poll is
  woken and shows each new or changed one waiting for Allow there (a renamed one is allowed
  again). Its folders are picked in
  Wysebee Agent on the Mac. Its skills — scripts and files included — are made on Skills
  ([Skill files](#skill-files)), and allowed on the Mac like any other.
- **Not here**: the local database (one computer's SQLite file) — a Mac agent living here has
  none. `load_skill` lists scripts as run with `skill_run_script` on the Mac.

No migration: the tables and the claim's row are the ones above.

### Agent types (`agent_types`, 2026-11-13, later)

**Which kinds of device can pair is data, not code** (the owner's call; both device
protocols' "agent types are a table"): a table of agent types, so a new one is registered —
later, from Wysebee Admin, which writes the table directly; **this service only reads it**
(`apps/cloud/agent_types.py`), at most 60 s old, so a change takes effect within a minute.

| Column | |
|---|---|
| `id` uuid | Never changes, never reused |
| `key` text, unique | What a device sends as `kind`: `wysebee-` then `a-z0-9-`, 3-64 characters |
| `name` text | Shown to people: 1-60 characters |
| `description` text | At most 500 |
| `link_field` text | The agent setting that holds a link of it: `browser_link`, `mac_link` or `android_link` (the three the code knows) |
| `ops` jsonb | The ops its link takes: at most 100 distinct names of 1-64 `a-z0-9_` |
| `tool_kinds` jsonb | The tools only its agents may have, the same limits |
| `enabled` boolean | False: no new pairing of it; links made keep working |

**Seeded** (fixed ids, the same in every environment): `wysebee-browser-chrome` "Wysebee Chrome
Agent" (`6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c01`, `browser_link`, the browser's 24 ops,
`browser` … `website`) and `wysebee-osx` "Wysebee OSX Agent"
(`6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c02`, `mac_link`, `ping` `local_run` `skill_run`
`folder_call`, `local` `folder` `sqlite` `skill_scripts`); and, by migration 0051,
`wysebee-windows` "Wysebee Windows Agent" (`6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c04`) — Wysebee
Agent for Windows (`wysebee-agent-win`), which speaks the Mac app's protocol unchanged, so its
row is the Mac type's but for its key, name and description (its links' legacy `kind` is
`osx`) — and, by migration 0069 (2026-11-16), the op `program_run` and the tool kind
`any_program`: **Run any program** (`run_any_program` in the agent's settings), one tool,
`run_program`, where the AI names the program and its arguments, run by Wysebee Agent for
Windows (for Mac too since 0072) only while the person has turned on "Let Wysebee run any program on this PC" there
(and refused for a list of dangerous programs) — and, by migration 0070, the ops
`screen_screenshot` and `screen_action` and the tool kind `screen`: **Screen control**
(`screen_control`), screenshots handed to the model as images and the mouse and keyboard
worked, only while the person has turned on "Let Wysebee see and control this PC's screen" —
and, by migration 0071, the ops `dev_shell`, `dev_job`, `dev_file` and `android_dev` and the
tool kinds `developer` and `android_toolkit`: **Developer access** (`developer_access`: a
shell, background jobs and files anywhere on the PC, `apps/cloud/agent_chat/pc_dev.py`) and the
**Android Development Toolkit** (`android_toolkit`: Wysebee Desktop's adb tools, named `adb_*`
for the model), each only while its switch is on in Wysebee Agent. By migration 0072
(2026-11-17, the owner's call) **the Mac's type has all four too**, exactly as Windows (the
ops `program_run`, `screen_screenshot`, `screen_action`, `dev_shell`, `dev_job`, `dev_file`,
`android_dev`; the tool kinds `any_program`, `screen`, `developer`, `android_toolkit`), the
tools' words the agent's computer's (`mac.device_of`: a Mac's zsh, bash or sh and `/Users/…`
paths, `~/Downloads/Wysebee`, `cmd`-keys and macOS's Screen Recording and Accessibility; a
Windows PC's PowerShell or cmd and `C:\` paths), plus the Mac's alone, the **iPhone
Development Toolkit** (`ios_toolkit`: the op `ios_dev`, the tool kind `ios_toolkit`; thirteen
tools named `xcode_*` for the model — devices, screenshot, logs, apps, info, boot, shutdown,
open_url, launch, terminate, appearance, install, uninstall — over the Mac's iOS simulators and
paired iPhones through Xcode, `apps/cloud/agent_chat/ios_dev.py`), answered only while "Let
Wysebee use iPhones and simulators on this Mac" is on there. The Windows type never has it (no
Xcode on Windows). A tool both types list is refused to other agents in words naming both apps
(`tool_kinds.WHO_TYPES`);
and, by migration 0079 (2026-11-18, the owner's call), `wysebee-linux` "Wysebee Linux Agent"
(`6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c06` — the protocol proposed `…5c05`, the Android type's),
`mac_link` — Wysebee Agent for Linux (`wysebee-agent-linux`, a command line and systemd
service for Linux desktops, servers and cloud VMs): the Windows type's row without the
screen's (ops `ping` `local_run` `skill_run` `folder_call` `program_run` `dev_shell` `dev_job`
`dev_file` `android_dev`; tool kinds `local` `folder` `sqlite` `skill_scripts` `any_program`
`developer` `android_toolkit`), no iPhone toolkit. Its tools' words are a Linux machine's
(`mac.LINUX`): bash (the default), zsh or sh, `/home/…` paths, and each switch named with the
command that turns it on (`wysebee-agent enable any-program | developer | android`), since it
has no window. The Devices page pairs it ("Pair a Linux machine");
and, by migration 0059, `wysebee-android` "Wysebee Android Agent"
(`6f1c3f7e-0b8a-4c51-9a8e-1d3b2f4a5c05`, `android_link`, `ping` and nine `android_*` ops,
`android`) — Wysebee Agent for Android (`wysebee-agent-android`; `docs/protocol/android.md`),
which lets the agent operate a phone in the apps the person allowed there. Its links' legacy
`kind` is `android`; its poll carries only calls, as a browser's does; its agent's settings
are `{label, android_link}` (no `browser_access`), and Wysebee Assistant
offers it the phone pack (`apps/cloud/agent_chat/android.py`: one tool per op, a snapshot or
screenshot's picture beside its text, 60 s). `wysebee-browser-edge` is planned.

- **A row that breaks those limits is no type**: logged (by its id) and left out — a device
  naming it cannot start pairing, a code of it pairs nothing (422 `invalid_kind`, the code
  kept), its links take no op and show `agent_type: null` — never a crash.
- **`POST /start`** takes an **enabled** type's key; from builds made before types, `osx`,
  `browser` or no `kind` name the seeded ones. Anything else is 422 `invalid_kind`.
- **A link** keeps `agent_type_id`; the old `kind` column stays (`browser` / `osx` / `android`, by
  `link_field`). **`Link`** gains `agent_type: {id, key, name}` and keeps `kind` for older
  clients.
- **An op** is relayed only when the link's type lists it (else 422 `invalid_op`); the device
  decides what it does.
- **The claim** writes the link into the type's `link_field` and sets `paired_kind` (the
  type's key) and `agent_type_id` — the cloud's only, kept when unpaired; **a reconnect needs
  the same key** (an agent paired from Chrome is not reconnected from Edge). What a new agent
  starts with, and what a Mac's poll carries, is still code, by `link_field`.
- **`GET /api/v1/agent-types`** (signed in): `{types: [{id, key, name, description, enabled}]}`,
  enabled first — for the apps to show names; not `ops` or `tool_kinds`.

**Migration 0050** makes the table, seeds it, fills `browser_links.agent_type_id` from
`kind`, and rewrites every agent's `paired_kind` (`browser` → `wysebee-browser-chrome`, `osx`
→ `wysebee-osx`) with its `agent_type_id` (an agent paired before `paired_kind` gets both from
its link), each a new revision. **Deploy it with this build, before the Mac app that sends
`wysebee-osx` or the extension that sends `wysebee-browser-chrome`** (a cloud without it
refuses those as `invalid_kind`); the legacy kinds keep working throughout.

### Which agent may add which tool

Each tool kind belongs to the agent type pack of the kind of device that has it
(`apps/cloud/packs/`: its `tool_kinds`, names and switches — [Extensions](#extensions)); the
website reads them from `GET /api/v1/agent-types` (until 2026-11-21 two copies of a
`tool_kinds.json`, which had drifted). **Which agents may have a tool is the agent types' rows**
(above): a type's `tool_kinds` lists the tools only its agents may have, and an agent's type
is the type of the link it holds now (`CONFIG.agent_type_id` while its `link_field` is set;
none: a plain agent). A tool no type lists is any agent's.

**A save of an agent — `POST` or `PUT /api/v1/agents`, from any client — that *adds* a tool
some type lists to an agent whose type does not is refused**:
422 `{"detail": "<English sentence: which kind of agent can have it, and how one is made>",
"code": "wrong_agent_kind"}`, and nothing of the request is saved (`apps/cloud/tool_kinds.py`,
called by `agents.py` after `keep_link`). "Adds" is by the stored settings (none for a new
agent) against the one sent: the web development tools, `browser_devtools: true`. Browser
access itself is not looked for (it cannot exist without the link). **A site link or a program
is a tool given** (since migration 0061): giving the first of a kind to an agent whose type does
not list it is the same 422, from `PUT /api/v1/agents/{agent_id}/tools`
(`tool_kinds.may_have`). **Keeping, changing or removing a tool is
always allowed**, so what an agent had before the rule — or keeps after its browser or Mac was
unpaired — stays, to change or remove.

## The skill catalog was removed (2026-11-12)

From 2026-11-11 to 2026-11-12 the website's Skills page had a skill catalog (a
Design tab with Figma's skills), which this server downloaded from GitHub into the person's
library (`/api/v1/skill-catalog`, `apps/cloud/skill_catalog.py`). The person's call: an AI app
such as Claude loads those skills itself, so it went. Skills somebody installed from it stay in
their library as ordinary skills.

## Deploy (Docker)

```bash
docker build -t wysebee-cloud .
docker run -p 8000:8000 wysebee-cloud
```

The container listens on `$PORT` if set (Cloud Run, Render, Fly, ...), otherwise
`$WYSEBEE_PORT` (default 8000). Settings use the `WYSEBEE_` env prefix.

### Azure Container Apps

Deploy only the `web` image, pointed at Azure Database for PostgreSQL (flexible server).

**The hosted service** is released from its own repository, which builds on this image: it
builds and pushes `wysebee-cloud:v<version>` from a checkout of a release, then its own image on
top (with its extension), and rolls the container app onto that.

**Build for `linux/amd64`.** Container Apps runs amd64 only; a plain `docker build` on an
Apple-silicon Mac produces arm64, which Azure will not start. Either build in Azure:

```bash
az acr build --registry <acr> --image wysebee-cloud:<tag> .
```

or build locally for amd64 and push:

```bash
docker buildx build --platform linux/amd64 -t <acr>.azurecr.io/wysebee-cloud:<tag> --push .
```

**Create the app** (registry, environment and resource group already exist):

```bash
az containerapp create -n wysebee-cloud -g <rg> --environment <env> \
  --image <acr>.azurecr.io/wysebee-cloud:<tag> --registry-server <acr>.azurecr.io \
  --ingress external --target-port 8000 \
  --secrets db-url='postgresql+psycopg://<user>:<password>@<server>.postgres.database.azure.com:5432/wysebee?sslmode=require' \
  --env-vars WYSEBEE_DATABASE_URL=secretref:db-url \
  --min-replicas 1 --max-replicas 3
```

- **`sslmode=require`** — Azure Postgres refuses unencrypted connections.
- **Percent-encode the password** if it has `@ : / ? # %` in it (`@` → `%40`), or the URL
  is misread.
- **Create the `wysebee` database** on the server first; the container creates the tables
  (`alembic upgrade head` on every start, under a lock, so several replicas are safe).
- **Networking:** allow the Container Apps environment's outbound IPs in the server's
  firewall, or put both on a VNet.
- **Probes:** Container Apps ignores the Dockerfile's `HEALTHCHECK`. Set them on the
  app (portal → Containers → Health probes, or YAML): liveness `GET /api/health`,
  readiness `GET /api/ready` (503 while the database is unreachable, so traffic waits
  rather than errors), both on port 8000.
- Usage events: kept in Postgres unless `WYSEBEE_EVENTS_ENABLED=false`; forwarded to Mixpanel
  when `WYSEBEE_MIXPANEL_TOKEN` is set (plus `WYSEBEE_MIXPANEL_API_HOST` for an EU project).
  `WYSEBEE_EVENTS_RETENTION_DAYS` (395) and `WYSEBEE_EVENTS_BATCHES_PER_MINUTE` (30) as needed.
- Sign-in: the production Auth0 tenant — `WYSEBEE_AUTH_ISSUER`, `WYSEBEE_AUTH_WEB_CLIENT_ID`
  (and `WYSEBEE_AUTH_AUDIENCE` if not the default); see [Sign-in](#sign-in-auth0). Unset,
  `/api/v1/me` answers 503 and the landing page says sign-in isn't available.

  ```bash
  az containerapp update -n <app> -g <rg> --set-env-vars \
    WYSEBEE_AUTH_ISSUER=https://<tenant>.us.auth0.com/ \
    WYSEBEE_AUTH_WEB_CLIENT_ID=<web client id>
  ```
- **File storage: Azure Blob Storage** (`WYSEBEE_ASSET_STORE=azure`, which skill files and
  workspaces follow). A container's own disk is lost with every new revision (and is not shared
  between replicas), so the file store is not for production. Create a storage account with a
  private container for each store — `user-assets`, `user-skills` and `user-workspaces` — give
  the app a managed identity, and grant that identity **Storage Blob Data Contributor** on
  each container (a grant is scoped to its container and does not reach the others):

  ```bash
  az storage account create -n <storage> -g <rg> --sku Standard_LRS --kind StorageV2 \
    --allow-blob-public-access false --allow-shared-key-access false --min-tls-version TLS1_2

  PRINCIPAL=$(az containerapp identity assign -n <app> -g <rg> --system-assigned --query principalId -o tsv)
  STORAGE_ID=$(az storage account show -n <storage> -g <rg> --query id -o tsv)
  for c in user-assets user-skills user-workspaces; do
    az storage container-rm create --storage-account <storage> -g <rg> -n "$c" --public-access off
    az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
      --role "Storage Blob Data Contributor" --scope "$STORAGE_ID/blobServices/default/containers/$c"
  done

  az containerapp update -n <app> -g <rg> --set-env-vars \
    WYSEBEE_ASSET_STORE=azure \
    WYSEBEE_STORAGE_AZURE_ACCOUNT_URL=https://<storage>.blob.core.windows.net
  ```

  Deployments made while desktop backups were kept here set the account as
  `WYSEBEE_BACKUP_AZURE_ACCOUNT_URL`, which is still read, so they need no change. (Their
  `backups` container is no longer used; migration 0062 did not delete its blobs.)
  `WYSEBEE_ASSET_AZURE_ACCOUNT_URL` is needed only for a different account.

  No key or connection string is stored: `DefaultAzureCredential` picks up the managed
  identity (a user-assigned one also works — set `AZURE_CLIENT_ID` to its client id). A
  role assignment can take a few minutes to apply; until then uploads fail with 403. To
  run the app against the account from a laptop, `az login` as someone with the same role.

  *Stray blobs.* A file can be left behind only when the app stops between deleting its row
  and deleting its blob. An asset or a skill file may be any age, so **do not add an
  age-based delete rule for current blobs**. Expect at most `WYSEBEE_ASSET_MAX_COUNT` ×
  `WYSEBEE_ASSET_MAX_BYTES` (100 MiB) of assets per person.
- Optional: `WYSEBEE_MIGRATE_ON_START=false` if migrations run as a separate release step.
- Point the `app.wysebee.com` custom domain at the app (`az containerapp hostname add` / `bind`).
- **The share domain, `wysebee.io`** ([Sharing a page](#sharing-a-page-with-everyone)): the
  same app, on a second custom domain, which then answers with shared pages only. Use a
  registered domain of its own — not a subdomain of `wysebee.com` (where the app is, `app.wysebee.com`), which blocklists and cookies
  treat as the same site — and keep nothing else on it (no mail, no other site).

  ```bash
  # 1. DNS at the wysebee.io registrar: an apex domain cannot be a CNAME, so an A record to the
  #    environment's static IP, and the TXT record that proves the domain is yours.
  az containerapp env show -n <env> -g <rg> --query properties.staticIp -o tsv          # A    @      -> <ip>
  az containerapp show -n <app> -g <rg> --query properties.customDomainVerificationId -o tsv   # TXT  asuid  -> <id>

  # 2. Add the hostname and a free managed certificate (once DNS has propagated).
  az containerapp hostname add -n <app> -g <rg> --hostname wysebee.io
  az containerapp hostname bind -n <app> -g <rg> --hostname wysebee.io --environment <env> --validation-method HTTP

  # 3. Tell the app.
  az containerapp update -n <app> -g <rg> --set-env-vars WYSEBEE_SHARE_URL=https://wysebee.io
  ```

  Then check: `https://wysebee.io/robots.txt` says `Disallow: /`, `https://wysebee.io/app/` is a
  404, and a page shared afterwards has a `https://wysebee.io/s/…` address. Pages shared before
  the setting keep their key; their address moves to the new domain (the old `app.wysebee.com/s/…`
  one stops working). Also worth doing: keep `www.wysebee.io` unset or pointing at the apex, and
  consider registering the domain with Google Search Console so abuse reports reach you.

## License

Copyright (c) 2026 Wysebee Inc.

Wysebee Cloud is free software under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0-only). You may use, change and share it, and run it as your own server. If you
run a modified version as a service other people use over a network, you must offer them
your changes' source under the same license. The Wysebee Agent apps are separate projects,
each under its own license (MIT).

# Developing Wysebee Cloud

How to run wysebee-cloud on your own machine and work on it day to day. Run every command
from the **repository root**.

The [README](../README.md) is the reference for each feature (the API, sign-in, cloud
items, assets, skills, workspaces) and for deploying to Azure. This page is the workflow.

## Prerequisites

| Tool | Why |
|---|---|
| Docker Desktop | The local stack: the web app and PostgreSQL, each in a container |
| [uv](https://docs.astral.sh/uv/) | The Python environment, tests, and running the app on the host |
| Node.js 22 and yarn (`corepack enable`) | Building and serving the front ends in `ui/` |
| ngrok v3 (optional) | Only to use the Auth0 dev tenant through a public URL |

## Three clouds

There are three wysebee-clouds; the website and the Wysebee Agent apps are built against
each.

| Name | Where | Sign-in | File storage (assets, skill files, workspaces) | Tracked |
|---|---|---|---|---|
| `local` | `docker compose` on this machine, `http://localhost:8000` | **Mock**: type any name and email, no account | Files on Docker volumes | No |
| `dev` | The dev deployment on Azure Container Apps | Auth0 dev tenant | Azure Blob Storage | No |
| `prod` | `https://app.wysebee.com` | Auth0 | Azure Blob Storage | Yes |

This page is mostly about `local`. For `dev` and `prod`, see [Deploying](#deploying).

## Run it locally

### 1. Settings: `.env`

`.env` is git-ignored. `./scripts/dev_up.sh` copies it from `.env.example` the first
time. For a local stack with no Auth0 account, it needs one line:

```bash
WYSEBEE_AUTH_MOCK=true
```

Leave `WYSEBEE_AUTH_ISSUER` and `WYSEBEE_AUTH_WEB_CLIENT_ID` empty: with the mock on they
default to `http://localhost:8000/mock-auth/` and `wysebee-web-local`. Leave
`WYSEBEE_MIXPANEL_TOKEN` empty so nothing goes to Mixpanel. Usage events are still kept in the
local database's `usage_events` table (2026-11-15), which is how to check them:
`docker compose exec db psql -U wysebee wysebee -c "SELECT occurred_at, event, page, properties FROM usage_events ORDER BY id DESC LIMIT 20"`.

Storage needs no setting. `docker-compose.yml` sets `WYSEBEE_ASSET_STORE=file`, so assets go
to the `assets` volume (`/data/assets`), skill files to `user-skills` and workspaces to
`user-workspaces`, never Azure Blob. An asset is the file
`/data/assets/<user id>/<asset id>`, the same name it has in the `user-assets` blob
container on Azure (for the mock user, `mock|dev@wysebee.local/…`).

### 2. Start the stack

```bash
./scripts/dev_up.sh
```

It builds the image, starts PostgreSQL and the web app in the background, waits until
both are healthy, and prints:

```
[dev] up:
  web app    http://localhost:8000   (your agents: /app/)
  sign-in    http://localhost:8000/mock-auth/ (mock: no Auth0 account)
```

The other forms:

```bash
./scripts/dev_up.sh --logs     # start, then follow the web app's logs
./scripts/dev_up.sh --down     # stop everything; data stays in the volumes
docker compose logs -f web     # the logs, any time
docker compose down -v         # stop and WIPE the database, files and mock key
```

Migrations run when the container starts (`WYSEBEE_MIGRATE_ON_START`, default true).
PostgreSQL is published on `127.0.0.1:5432`, with user, password and database all
`wysebee`, for psql or a GUI.

### 3. Check it

- `http://localhost:8000/api/healthcheck`: version, database up, migrations current
- `http://localhost:8000/api/v1/web/config`: `auth.issuer` should be
  `http://localhost:8000/mock-auth/`
- `http://localhost:8000/docs`: the interactive API docs
- `http://localhost:8000/app/`: the web app. **Sign in** opens the mock page.

## Mock sign-in

With `WYSEBEE_AUTH_MOCK=true` the app is its own OpenID Connect provider at
`/mock-auth/` (`apps/cloud/mock_auth.py`). `GET /api/v1/web/config` announces it to the web
pages in place of Auth0 (client `wysebee-web-local`). They then run their normal sign-in,
authorization code with PKCE, against it unchanged.

- **Who you are.** The page asks only for a name and an email. You become
  `sub` = `mock|<email>`, so the same email is the same person every time, with the same
  agents, tasks and assets. Use a second email to test as a second person.
- **Tokens.** Real RS256 JWTs: access tokens last an hour and refresh like Auth0's. The
  signing key is made on first start and kept on the `mockauth` volume, so a restart
  does not sign anyone out. `docker compose down -v` deletes the key, and every page
  must sign in again.
- **Safe by construction.** It is off unless `WYSEBEE_AUTH_MOCK=true`. Settings refuse to
  start with it on if the issuer is not `localhost` or `127.0.0.1`. It redirects only to
  its own origin and loopback addresses (the Vite dev servers). Never set it in a deployment.
- **To use Auth0 locally instead.** Set `WYSEBEE_AUTH_MOCK=false`, fill in the
  `WYSEBEE_AUTH_*` values for the dev tenant (the README's "Sign-in (Auth0)"), and
  restart. The tenant's website application must list the address you use.

## Day to day

### Back end on the host (hot reload)

Run only the database in Docker and the app with uvicorn's `--reload`:

```bash
docker compose stop web              # free port 8000
docker compose up -d db
uv sync
uv run uvicorn apps.cloud.main:app --reload
```

The app reads `.env` itself. `WYSEBEE_DATABASE_URL` in `.env.example` already points at
the compose database on `localhost:5432`. On the host, assets go to `./data/assets`,
skill files to `./data/user-skills`, workspaces to `./data/user-workspaces` and the mock key to
`./data/mock-auth/key.pem`. All are git-ignored.

The landing page and `/app/` are served from `apps/cloud/dist`, so build them once with
`cd ui && yarn install && yarn build`, or use the Vite servers below.

### Front end (hot reload)

```bash
cd ui
yarn dev        # the landing page, http://localhost:5173
yarn dev:app    # the web app, http://localhost:5174/app/
```

Both proxy `/api` to `http://localhost:8000`, whether that is the container or uvicorn on
the host. Mock sign-in works from them too: the mock provider allows localhost origins.

### After a change

- Python or a migration: `./scripts/dev_up.sh` rebuilds the image. With uvicorn
  `--reload`, there is nothing to do.
- A new migration: after changing `models.py`, run
  `uv run alembic revision --autogenerate -m "add something"` against the compose
  database, then restart; the container applies it. The README's "Migrations" section has
  more.
- The front end: `yarn build` before `dev_up.sh`, or rely on the image build, which runs
  it too.

### Another port

If port 8000 is taken, move the cloud. In `.env`:

```bash
WEB_PORT=8001
WYSEBEE_AUTH_ISSUER=http://localhost:8001/mock-auth/
```

The Vite proxies still target 8000. Change `ui/*/vite.config.ts` locally if you need them
too.

## Checks before you commit

```bash
uv run pytest                    # the API, auth (mock sign-in included), storage, migrations
cd ui && yarn test               # the web app (yarn test --coverage for the 100% gate)
cd ui && yarn check:locales      # every translation has every key
```

Database tests are skipped unless you point them at a database of their own — its name ending
in `_test`, made on the compose server when it is not there. Never the app's `wysebee`: the
migration tests downgrade the database to 0005 and back, which drops every pairing, skill,
workspace and task in it, and the tests refuse any other name:

```bash
WYSEBEE_TEST_DATABASE_URL=postgresql://wysebee:wysebee@localhost:5432/wysebee_test uv run pytest
```

## Deploying

`dev` and `prod` run the same image on Azure Container Apps, with Azure Database for
PostgreSQL, Azure Blob Storage for assets, skill files and workspaces
(`WYSEBEE_ASSET_STORE=azure` and the account in `WYSEBEE_STORAGE_AZURE_ACCOUNT_URL` — or
`WYSEBEE_BACKUP_AZURE_ACCOUNT_URL`, the name the deployments set while desktop backups were kept,
still read — signed in with the app's managed identity) and their own
Auth0 tenant. They are released from the hosted service's own repository, whose image is this
one with its extension added ([README, Extensions](../README.md#extensions)).

Never set `WYSEBEE_AUTH_MOCK` on either one. Leave `WYSEBEE_MIXPANEL_TOKEN` unset on `dev`
so nothing from it reaches Mixpanel (its events are kept in its own database only). The README's "Deploy (Docker)" section covers the one-time Azure
setup.

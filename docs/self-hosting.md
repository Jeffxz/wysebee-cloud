# Self-hosting Wysebee Cloud

Run your own Wysebee Cloud: the web app, your agents (browser, Mac, Windows, Linux, Android),
skills, workspaces, scheduled tasks and Wysebee Assistant for your AI app. There's no Auth0
account to set up and nothing to pay for.

A self-hosted server is **one person's**. It's the same code as the hosted service, started with
`WYSEBEE_EDITION=selfhost`:

| | Hosted (`cloud`, the default) | Self-hosted (`selfhost`) |
|---|---|---|
| Sign-in | Auth0 (OIDC) | None. Every request is the owner, optionally behind a shared token |
| Extensions (e.g. the hosted plans) | As the deployment loads them | None. No Billing page, no limits |
| Account deletion | Auth0, and what extensions hold | Not served (it's your database) |
| Usage events | On, optionally forwarded to Mixpanel | Off unless `WYSEBEE_EVENTS_ENABLED=true` |
| Storage quota | 1 GiB, or what an extension gives | 100 GiB unless `WYSEBEE_STORAGE_QUOTA_BYTES` is set |
| `/` | Landing page | Redirects to the web app at `/app/` |

## Start it

You need Docker with Compose v2, and this repository checked out. Then:

```bash
./scripts/selfhost.sh
```

The first time, it walks you through six steps and starts the server:

1. **Docker**: checks it is installed and running.
2. **The settings file**: makes `.env.selfhost` from `.env.selfhost.example` (git-ignored, readable by you alone).
3. **Secrets**: makes the database password and `WYSEBEE_AI_KEK`, the key your agents' saved database
   passwords are sealed under. **Back up `.env.selfhost`**: without that key they cannot be read.
4. **About you**: your name and email, as the pages show you.
5. **Who can reach it**: this computer only (no token), or other devices on your network too (an
   access token, the port published on your network, and an optional public HTTPS address).
6. **Port**: 8000, or the next free one.

Then it builds the image from your checkout, starts it, waits until it answers, and says what to
do next: the address to open, the access token if there is one, the command that connects your AI
app, and how to pair each kind of device. The database schema is migrated each time it starts.

After that:

| Command | |
|---|---|
| `./scripts/selfhost.sh` or `start` | Start it |
| `./scripts/selfhost.sh setup` | Change the settings (secrets are kept), then restart |
| `./scripts/selfhost.sh update` | After a `git pull`: rebuild and restart |
| `./scripts/selfhost.sh stop` | Stop it; your data stays |
| `./scripts/selfhost.sh status` / `logs` / `token` | Is it running and where / follow its logs / show the access token |

It runs as its own Docker Compose project, `wysebee-selfhost`, so it never touches the development
stack (`docker-compose.yml`) in the same checkout. **Your data** is in that project's volumes
(`pgdata`, `assets`, `user-skills`, `user-workspaces`, `recordings`): back them up with `.env.selfhost`.

By hand instead: `cp .env.selfhost.example .env.selfhost`, set `POSTGRES_PASSWORD` (letters and
digits: `openssl rand -hex 24`; it goes into the database's URL) and `WYSEBEE_AI_KEK`
(`openssl rand -base64 32`), then
`docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --build`.

## The token, and who can reach it

| `WYSEBEE_SELFHOST_TOKEN` | What happens |
|---|---|
| empty | Anyone who can reach the port **is you**. The compose file publishes it on `127.0.0.1` only, and the server logs a warning at start. |
| set | Every request must carry `Authorization: Bearer <token>`. The web app asks for it once and keeps it in that browser. "Sign out" forgets it. |

Agents on **other devices** (your phone, another PC) must reach the server, so:

1. Set `WYSEBEE_SELFHOST_TOKEN` (`openssl rand -base64 32`).
2. Set `WEB_BIND=0.0.0.0` to publish the port on your network.
3. Beyond your own network, put HTTPS in front (Caddy, nginx, Cloudflare Tunnel, Tailscale) and set
   `WYSEBEE_PUBLIC_URL` to that address.

Agents never send the token. They pair with a code you type in the web app and then use their own
secret ([the browser link](../README.md#the-browser-link-apiv1browser-links)). Treat the token like a
password: agents can run programs and control screens on the devices you pair.

## Pair your agents

Point each agent at your server instead of the hosted service:

| Agent | Setting |
|---|---|
| Wysebee Agent for Mac / Windows / Linux | `WYSEBEE_CLOUD_URL=http://<your server>:8000` |
| Wysebee Agent for Android | Built with `WYSEBEE_AGENT_ANDROID_LOCAL_CLOUD_URL` (a runtime setting is to come) |
| Wysebee Agent browser extension | Not yet: its server is fixed in `server.js` (a setting is to come) |

Then pair as usual: the agent shows a code, and you type it in the web app's Agents page.

## Your AI app (Wysebee Assistant)

Wysebee Assistant is at `<your server>/assistant/mcp`. A self-hosted server has no OAuth to
discover. With a token set, give your AI app the header `Authorization: Bearer <token>`, for
example in Claude Code:

```bash
claude mcp add --transport http wysebee http://localhost:8000/assistant/mcp --header "Authorization: Bearer <token>"
```

## Settings

Every `WYSEBEE_*` setting in [apps/cloud/config.py](../apps/cloud/config.py) applies. Those that
matter here:

| Setting | Default | |
|---|---|---|
| `WYSEBEE_EDITION` | `cloud` | `selfhost` for your own server |
| `WYSEBEE_SELFHOST_TOKEN` | — | The shared secret above |
| `WYSEBEE_SELFHOST_USER_ID` | `local\|owner` | The id your data is kept under. Don't change it once you have data |
| `WYSEBEE_SELFHOST_USER_NAME` / `_EMAIL` | `Owner` / — | How the pages name you |
| `WYSEBEE_AI_KEK` | — | Seals your agents' database passwords. Back it up |
| `WYSEBEE_PUBLIC_URL` | from each request | Your server's public address |
| `WYSEBEE_EVENTS_ENABLED` | `false` | Keep usage events in your database |
| `WYSEBEE_STORAGE_QUOTA_BYTES` | 100 GiB | Files you may keep: pictures, skill files, recordings |

The hosted service's settings (`WYSEBEE_AUTH_*`, `WYSEBEE_AUTH0_MGMT_*`,
`WYSEBEE_MIXPANEL_*`) are ignored or unused. `WYSEBEE_AUTH_MOCK` is refused.

## Back up

Back up the `pgdata` volume (or `pg_dump`), the file volumes (`assets`, `user-skills`,
`user-workspaces`, `recordings`) and your `.env.selfhost`.

# Security

Wysebee Cloud pairs with agents that can run programs, read files and control the screen on
the devices people pair. Please report security problems privately so they can be fixed
before they're known.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: open this repository's **Security** tab
and choose **Report a vulnerability**. Please don't open a public issue or pull request for
a security problem.

Include what you can:
- what an attacker can do, and what they need first (an account, a paired device, network access);
- the steps or a proof of concept;
- the version (`GET /api/v1/info`) and edition (hosted or `WYSEBEE_EDITION=selfhost`).

We aim to acknowledge a report within a few working days, keep you updated while it's
fixed, and credit you in the advisory if you'd like.

## In scope

- This repository: the API, the web app at `/app/`, Wysebee Assistant (`/assistant/mcp`) and
  the agent pairing protocol (`/api/v1/browser-links`, `/api/v1/agent-links`).
- Both editions: the hosted service's sign-in and the self-hosted edition's token check.
- Ways for one person to reach another person's data, or for a device or AI app to do more
  than the person approved.

## Out of scope

- A self-hosted server run without `WYSEBEE_SELFHOST_TOKEN` and reachable from a network:
  that configuration is documented as open to anyone who can reach it
  ([docs/self-hosting.md](docs/self-hosting.md)).
- The Wysebee Agent apps (browser extension, Mac, Windows, Linux, Android): report those in
  their own repositories.
- Denial of service by volume, missing hardening headers without a demonstrated impact,
  and findings that need a compromised device or browser.

## Supported versions

Fixes go into `main` and the next release. Self-hosters should run the latest release.

# Contributing to Wysebee Cloud

Thanks for helping. This page covers setting up, testing and sending a change. For what
each feature does, see the [README](README.md). For the day-to-day local workflow, see
[docs/development.md](docs/development.md). To run your own server, see
[docs/self-hosting.md](docs/self-hosting.md).

Security problems go through [SECURITY.md](SECURITY.md), not issues.

## Set up

You need Docker, [uv](https://docs.astral.sh/uv/), and Node.js 22 with yarn (`corepack enable`).

```bash
./scripts/dev_up.sh
```

That starts PostgreSQL and the app at http://localhost:8000. Put `WYSEBEE_AUTH_MOCK=true` in
`.env` to sign in as anyone, with no Auth0 account (docs/development.md explains it).

## Test

Both test suites must stay at **100% coverage**: CI fails below it.

The API tests need a PostgreSQL database of their own, whose name ends in `_test`. They
refuse any other database, because they migrate it down and drop what is in it:

```bash
WYSEBEE_TEST_DATABASE_URL=postgresql://wysebee:wysebee@localhost:5432/wysebee_test uv run pytest --cov
```

The web app's tests, translations and build:

```bash
cd ui && yarn test --coverage && yarn check:locales && yarn build
```

Blob storage tests also run against Azurite when `WYSEBEE_TEST_AZURITE_CONNECTION_STRING`
is set; CI sets it.

## Make a change

- Work on a branch and open a pull request against `main`. CI runs both test suites and
  builds the Docker image.
- Keep a pull request to one change, with tests for what it adds or fixes.
- A database change is a new Alembic migration in `migrations/versions/`. Don't edit a
  released one.
- Every user-facing string in the web app goes in all locales under
  `ui/app/src/i18n/locales/` (`yarn check:locales` checks).
- Wysebee Assistant's tools follow [docs/ai-apps-propose.md](docs/ai-apps-propose.md): an AI
  app may read, run what the person approved and propose changes, never change what an
  agent can do by itself.
- Write comments and docstrings that say why, the way the existing code does.

## License

Wysebee Cloud is licensed under the [GNU AGPL v3.0](LICENSE). By contributing, you agree
that your contribution is licensed under the same license.

# Contributing to Wickwatch

Thanks for helping! Wickwatch is a hobby project; please be patient with reviews.

## Before you start
- Open an issue for larger changes so we can agree on the approach.
- Read `BRAND.md` (design tokens, colours, voice) and `docs/ADAPTERS.md` (the core must stay broker- and strategy-neutral).

## Development
Requires Node 24+ and pnpm (version pinned in `package.json`, `corepack enable` picks it up).

```sh
pnpm install
cp .env.example .env   # then set MASTER_KEY=$(openssl rand -base64 32)
pnpm dev:server     # API on :3000, reads .env
pnpm dev:web        # SPA with hot reload, proxies /api to the server
pnpm check          # format check, lint, typecheck, tests – the same as CI
```

The demo adapter (`packages/adapter-demo`) provides fake data, so no broker or Docker is needed for development. On the first start the server adds the demo accounts and prints a one-time setup token; open the web app, enter the token, create the admin and scan the QR code with an authenticator app.

### Repository layout
| Path | Content |
| --- | --- |
| `apps/server` | Fastify server: config, auth, database and migrations, REST API with OpenAPI, serves the web app |
| `apps/web` | Vue 3 single-page app |
| `packages/core` | Broker- and strategy-neutral types, adapter contracts, shared logic and contract tests |
| `packages/adapter-*` | Adapter implementations (`adapter-demo`, `adapter-docker`) |
| `i18n/` | UI translations (`en.json` is the source, `de.json` the first translation) |
| `design/`, `assets/` | Design tokens and logo files, see `BRAND.md` |
| `templates/challenges/` | Prop-challenge templates as JSON |
| `deploy/` | Example compose files |
| `docs/` | Roadmap, adapter contracts, bot contract, configuration, OpenAPI document |

API changes: the OpenAPI document is generated from the route schemas. Run `pnpm --filter @wickwatch/server openapi` to update `docs/openapi.json`; a test fails when it is out of date.

Database changes are Kysely migrations in `apps/server/src/db/migrations/`: add a new file and register it in `index.ts`; never edit or rename an existing one.

## Developer Certificate of Origin (DCO)
Every commit must be signed off to certify that you wrote the code or have the right to submit it under the project licence (AGPL-3.0):

```
git commit -s -m "feat: add demo adapter"
```

This adds `Signed-off-by: Your Name <you@example.com>`. See https://developercertificate.org.

## Guidelines
- English for code, comments, commits (Conventional Commits) and docs.
- UI strings go into `i18n/en.json` and `i18n/de.json`, never inline.
- Use design tokens (`--ww-*`), support dark and light mode.
- Add or update tests; adapters must pass the contract test suite.
- No secrets, real account numbers or credentials in code, tests or screenshots.

# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org); versions are released as Git tags `vX.Y.Z`.

## Unreleased

### Added
- Monorepo with server (Fastify), web app (Vue 3), neutral core and demo adapter.
- Adapter contracts as TypeBox schemas with shared contract tests.
- Overview screen: accounts, instances, alerts, start/stop/restart, emergency stop per account.
- Built-in login with optional TOTP (can be skipped at setup, switched on/off under Account), first-run setup with a one-time token, roles `admin` and `viewer`.
- Encrypted broker credentials (AES-256-GCM, `MASTER_KEY`), accounts stored in the database.
- English and German UI, dark and light mode.
- Docker image, CI with DCO check, release workflow for GHCR.
- cTrader CLI broker adapter (read-only): accounts with active flag and names, balances, positions, orders, deals, algo metadata; one shell session per account.
- Docker runtime adapter: finds labelled containers, start/stop/restart, logs (also followed), host status.
- Accounts page: add accounts from the broker's list, rename, switch login, remove; broker logins with password change (encrypted, never shown again).
- Challenge profiles per account (from a template or entered manually): profit target, daily loss with reset time and time zone, static or trailing max drawdown, minimum trading days, duration; traffic light on the account card and alerts near limits. A background poller records balance and equity per trading day.
- Trade attribution per instance (`auto`, `label`, `label-pattern`, `account-symbol`), so third-party bots with their own labels work too; the only instance on an account takes all its trades; manual correction per position ("not from this bot", restorable).
- Instance detail page: key figures and realised P&L curve for 7/30/90 days, open positions (close with confirmation), pending orders, trade history, live log via SSE with filters.

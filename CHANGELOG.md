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
- Algos page: upload `.algo` files (admin), stored per name and version with their parameter metadata; version from the upload form, the bot's `BotVersion` parameter or its build time; duplicate files are rejected; old versions stay for rollbacks; delete with confirmation (audit-logged).
- Set up instances in the UI (admin): name, account, algo version, symbol (from the broker), timeframe, parameters generated from the algo metadata with defaults, ranges and "changed" markers, trade attribution. Every save is a configuration version with comment, author and a diff to the previous one; old versions can be restored or duplicated. Saving starts nothing; containers follow separately.
- Instances set up in Wickwatch run as containers it creates (docker runtime): create, create and start, or apply a newer configuration version (a restart when running), each after confirmation and audit-logged. The container runs the pinned cTrader CLI image with the parameters as arguments; algo and password are copied in, never passed as arguments. Compose-defined containers are never changed.
- Instance detail page: key figures and realised P&L curve for 7/30/90 days, open positions (close with confirmation), pending orders, trade history, live log via SSE with filters.
- "Connection lost" instead of "Running" when an instance's log says its broker connection is down (the container keeps running meanwhile), with an alert and the time it was lost. Broker adapters recognise such platform events in the log (cTrader CLI: lost/established/restored).
- Notifications without an open dashboard: `ALERT_WEBHOOK_URL` gets a JSON `POST` when an alert appears or goes away (text in `DEFAULT_LOCALE`, works with Telegram, Slack, Discord); `HEARTBEAT_URL` is pinged after every successful check (e.g. Healthchecks.io). Sent alerts are stored, so restarts do not repeat them; failed posts are retried.
- The cTrader CLI runs in the official image when Wickwatch itself runs in Docker (`CTRADER_CLI=container`, default in the image): batch calls and shell sessions use short-lived helper containers (`RuntimeAdapter.runTool`), so the proprietary CLI is never bundled. Works through docker-socket-proxy.
- Housekeeping: a database backup every `BACKUP_INTERVAL_HOURS` (default 24, consistent while running, newest `BACKUP_KEEP` kept), audit entries older than `AUDIT_RETENTION_DAYS` (default 365) and expired sessions are deleted hourly. Restore steps in `docs/CONFIGURATION.md`.
- Errors a bot throws while it keeps running (cTrader: "Crashed in … event with …") are counted per start and shown on the instance with the latest message; a crash in the last hour raises an alert (and a notification).
- Form fields tell what is wrong right next to them, translated, with a red border and text: forbidden characters while typing, other problems when leaving the field or sending. Values are tidied while typing where that is safe (instance names in lower case with hyphens, no spaces in logins, codes and symbols); symbols and timeframes are sent in the broker's spelling. A field the server rejects is marked too. Applies to all forms.
- Logins that only accounts of another broker adapter use (e.g. the demo logins after switching to `ctrader-cli`) are hidden like those accounts.

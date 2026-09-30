# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org); versions are released as Git tags `vX.Y.Z`.

## Unreleased

### Fixed
- Switching to another window or tab no longer marks an empty form field as left (e.g. "Required" on the login page right after loading).

## 0.1.0 – 2026-09-30

First release.

### Added
- Monorepo with server (Fastify), web app (Vue 3), neutral core and demo adapter.
- Adapter contracts as TypeBox schemas with shared contract tests.
- Overview screen: accounts, instances, alerts, start/stop/restart, emergency stop per account.
- Built-in login with optional TOTP (can be skipped at setup, switched on/off under Profile), first-run setup with a one-time token, roles `admin` and `viewer`.
- Encrypted broker credentials (AES-256-GCM, `MASTER_KEY`), accounts stored in the database.
- English and German UI, dark and light mode.
- Docker image, CI with DCO check, release workflow for GHCR.
- cTrader CLI broker adapter: accounts with active flag and names, balances, positions, orders, deals, algo metadata; one shell session per account.
- Docker runtime adapter: finds labelled containers, start/stop/restart, logs (also followed), host status.
- Accounts page: add accounts from the broker's list, rename, switch login, remove; broker logins with password change (encrypted, never shown again).
- Challenge profiles per account (from a template or entered manually): profit target, daily loss with reset time and time zone, static or trailing max drawdown, minimum trading days, duration; traffic light on the account card and alerts near limits. A background poller records balance and equity per trading day.
- Trade attribution per instance (`auto`, `label`, `label-pattern`, `account-symbol`), so third-party bots with their own labels work too; the only instance on an account takes all its trades; manual correction per position ("not from this bot", restorable).
- Algos page: upload `.algo` files (admin), stored per name and version with their parameter metadata; version from the upload form, the bot's `BotVersion` parameter or its build time; duplicate files are rejected; old versions stay for rollbacks; delete with confirmation (audit-logged).
- Set up instances in the UI (admin): name, account, algo version, symbol (from the broker), timeframe, parameters generated from the algo metadata with defaults, ranges and "changed" markers, trade attribution. Every save is a configuration version with comment, author and a diff to the previous one; old versions can be restored or duplicated. Saving starts nothing; containers follow separately.
- Instances set up in wickwatch run as containers it creates (docker runtime): create, create and start, or apply a newer configuration version (a restart when running), each after confirmation and audit-logged. The container runs the pinned cTrader CLI image with the parameters as arguments; algo and password are copied in, never passed as arguments. Compose-defined containers are never changed.
- Instance detail page: key figures and realised P&L curve for 7/30/90 days (smooth or stepped, remembered per browser; "All" since the instance's first trade when it traded before that, from the account history loaded once a day in the background), open positions (close with confirmation), pending orders (with their expiry when set), trade history, live log via SSE with filters.
- "Connection lost" instead of "Running" when an instance's log says its broker connection is down (the container keeps running meanwhile), with an alert and the time it was lost. Broker adapters recognise such platform events in the log (cTrader CLI: lost/established/restored).
- Notifications without an open dashboard: `ALERT_WEBHOOK_URL` gets a JSON `POST` when an alert appears or goes away (text in `DEFAULT_LOCALE`, works with Telegram, Slack, Discord); `HEARTBEAT_URL` is pinged after every successful check (e.g. Healthchecks.io). Sent alerts are stored, so restarts do not repeat them; failed posts are retried.
- The cTrader CLI runs in the official image when wickwatch itself runs in Docker (`CTRADER_CLI=container`, default in the image): batch calls and shell sessions use short-lived helper containers (`RuntimeAdapter.runTool`), so the proprietary CLI is never bundled. Works through docker-socket-proxy.
- Housekeeping: a database backup every `BACKUP_INTERVAL_HOURS` (default 24, consistent while running, newest `BACKUP_KEEP` kept), audit entries older than `AUDIT_RETENTION_DAYS` (default 365) and expired sessions are deleted hourly. Restore steps in `docs/CONFIGURATION.md`.
- Errors a bot throws while it keeps running (cTrader: "Crashed in … event with …") are counted per start and shown on the instance with the latest message; a crash in the last hour raises an alert (and a notification).
- Form fields tell what is wrong right next to them, translated, with a red border and text: forbidden characters while typing, other problems when leaving the field or sending. Values are tidied while typing where that is safe (instance names in lower case with hyphens, no spaces in logins, codes and symbols); symbols and timeframes are sent in the broker's spelling. A field the server rejects is marked too. Applies to all forms.
- Logins that only accounts of another broker adapter use (e.g. the demo logins after switching to `ctrader-cli`) are hidden like those accounts.
- cTrader CLI: closing a position, cancelling an order and the emergency stop per account work (orders are cancelled before positions are closed); each counts only when a fresh listing shows the position or order gone. Pending orders can be cancelled on the instance page (confirmation, audit log). "Close position" is now called that on the button too.
- Optional protection per challenge profile: once the daily or max loss limit is used up to a chosen share (e.g. 80 %), wickwatch runs the emergency stop for the account, once per trading day (instances started again by hand are left alone), audit-logged, with an alert and a notification. Off by default, for bots whose own daily stop cannot be trusted.
- Bots started from wickwatch get their parameters as a `.cbotset` file in the container instead of `--Name=Value` arguments, so `docker inspect` no longer shows values like licence keys; such values are also hidden in the start table of the log. `.cbotset` format support (`CONFIG_ADAPTER=cbotset`), checked against 316 real files.
- Parameter files in the UI: "Load parameters from file" in the instance form takes the values, symbol and timeframe of a `.cbotset` (e.g. exported from cTrader) and says what it did not take (rejected values as a warning, all of them with the reason); every configuration version can be downloaded as `.cbotset` (admins, audit-logged).
- Colour parameters of cBots (`#AARRGGBB` with a colour picker); algos uploaded before are repaired at start.
- Account page per account: its instances, all open positions and pending orders (with the instance each belongs to), figures, the challenge profile in a modal and the emergency stop when there is something to stop.
- Risk in % of the balance and result in R per trade, from the stop loss the position opened with (cTrader: from `orders-history`); columns in the trade history and average/total R in the key figures.
- A details panel (drawer) per position, order and trade: entry and exit, initial stop, opening and closing time with holding time, gross result, commission, swap, net, risk and R, label and IDs.
- Bots set up in wickwatch are started again after a host or Docker restart when they were meant to run; a bot that stopped itself stays stopped, and one that ends again within 10 minutes is given up (audit-logged). Stops, the emergency stop and the loss guard are no longer undone by this.
- Password change in the profile (needs the current password; other sessions are logged out).
- Footer with the version, the source code link (`SOURCE_URL`, for AGPL-3.0 §13) and a support link (`SUPPORT_URL`, Ko-fi by default, `off` hides it).
- Challenge templates for FTMO (2-Step, 1-Step, Free Trial) and The Trading Pit (CFD Prime, Classic), grouped by firm in the form. New max-drawdown type trailing on the end-of-day balance; trailing limits are a share of the start balance.
- Trading days are counted by the day a position opened, as prop firms do, including positions still open; they are marked right after a profile is saved and show "loading …" until then.
- Where the runtime has no empty text (cTrader CLI), every text parameter needs a value: the form, a loaded parameter file and the configuration tab say which ones, and a version without them cannot be applied.
- Stored algo metadata is read again at start when the reader learned more (`algoMetadataVersion`), so no re-upload is needed.
- A saved version the container does not use yet is also shown on the instance overview tab. The challenge on an account card folds away. Loading states show the radar spinner.
- `pnpm start` and `pnpm dev:server` let `.env` win over variables exported in the shell.
- Clock check with the Docker runtime: the server clock is compared hourly with `CLOCK_CHECK_URL` (default Cloudflare's trace); the header shows a clock icon with a tooltip (green up to 1 s, yellow up to 2 s, red beyond, each with its own shape; a question mark when the check had no usable answer lately, nothing when it is off), and more than 2 s raises an alert (`host_clock`, also as a notification).
- Daily summary to the alert webhook at `DAILY_SUMMARY_TIME` in `DAILY_SUMMARY_TIMEZONE`: per account balance, equity, today's P&L, positions, instances and the challenge rules, and the number of open alerts; sent once a day, also after a restart.
- Page and section heads on phones: the actions go below the heading with their labels (instance and account pages in two columns, algos, accounts and profile at full width) instead of wrapping one by one; the audit log filters take the full width.
- Audit log page for admins (user menu), with a time range filter (today, 7 or 30 days): time, user or "wickwatch" for its own actions, action, target (linked to instance and account pages), result and details; filters by action, action group and target, older entries page by page (`GET /api/v1/audit`).

### Fixed
- Applying a configuration no longer starts an instance that had crashed.
- The loss guard's emergency stop was undone by the automatic restart of stopped instances.
- Trading days of challenge profiles with a reset in the afternoon (e.g. 16:15 America/Chicago) were loaded from the wrong day start.
- cTrader CLI: the emergency stop no longer fails on a fresh session that has no prices yet; positions are counted without them.
- Deleting an instance set up in wickwatch fails (503) when the runtime cannot be asked, instead of removing the record and leaving the container running.
- The loss guard checks accounts in parallel, so a hanging broker session no longer delays the stop of another account.
- Lookups by account number and id (challenge profile, trade attribution, rename, remove, "should run" after a stop) only find accounts of the active broker adapter.
- A container killed for lack of memory counts as an error, not as stopped.
- `CTRADER_IMAGE` on a registry with a port but without a tag (`registry:5000/image`) is refused at start as not pinned.
- A live log closed while it was still opening no longer keeps following the container.
- The overview no longer hands out data of a hanging broker query as current: callers share a running query only within 5 seconds.

### Security
- API paths with percent-encoded characters (e.g. `/%61pi/v1/…`) reached the API without a login (read-only); authentication now goes by the matched route.
- Every state-changing API route outside `/auth/` is for admins only, also one that forgets its own check; destructive actions check the confirmation in one place.
- Instance refs in actions and the live log must be container-name characters.
- Parameter values of instance configurations are returned to admins only (viewers see that there are values, not what they are).
- Parameter values of instance configurations (they may hold licence keys) are stored encrypted with `MASTER_KEY`, like credentials; values stored before are encrypted once at start, so backups no longer contain them in plaintext.
- Switching 2FA off needs a current code besides the password; the code that was just used to log in does not count again.
- Encrypted values with a shortened authentication tag are rejected.
- Failed deploys and deletions of instances set up in wickwatch are audit-logged too, with the error.

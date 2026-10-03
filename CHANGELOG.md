# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org); versions are released as Git tags `vX.Y.Z`.

## Unreleased

### Changed
- Notifications about a lost broker connection or an account the broker does not answer for (timeout, unavailable; a failed login still comes at once) wait until it lasted `ALERT_DISCONNECT_GRACE_SECONDS` (default 180), so short drops that pass by themselves no longer send an alert and a resolution each. While the market is closed (of the instance's symbol; for an account, of all its instances), when brokers do their maintenance, `ALERT_DISCONNECT_GRACE_CLOSED_SECONDS` applies (default 1800; `off` holds them until the market opens). Any alert is resolved only once it stayed away for `ALERT_RESOLVE_DELAY_SECONDS` (default 120), so one that comes right back no longer sends "Resolved" and a new alert. The dashboard still shows everything at once.

## 0.4.1 – 2026-10-02

### Changed
- Overview: at most three account cards side by side, so they stay wide enough to read.
- The challenge on an account card stays folded, also on a warning; the badge in its head ("Near limit", "Breached") says so, and all cards keep the same height.

### Fixed
- Market badge: a click or tap opened the hours inside the table cell and pushed the rows apart; it now pins the tooltip open (a click elsewhere, Escape or scrolling closes it). Hours over midnight (e.g. forex) read as the trading week and its daily break ("Sun 23:00 – Fri 22:29", "Daily break 22:29–23:00") instead of "Sun–Thu 23:00 – 22:29 next day". Tooltip text is left-aligned. The server time in the header pins its tooltip on a tap the same way; on a phone it had no way to show it.
- Market hours of The Trading Pit stayed unknown: its sessions come in "Turkey Standard Time", which the cTrader adapter did not map. It now knows that and the other common broker time zones.

## 0.4.0 – 2026-10-02

### Added
- Account size check: on the Algos page, name the parameter an algo calculates positions with as its account size (e.g. a starting capital). The instance form marks a value more than 25 % off the account's challenge start balance (else its balance at the start of the trading day) and asks before saving, **Apply template…** warns before saving the version, and the Configuration tab shows a warning while it stays. Set per algo for all its versions, audit-logged as `algo.settings`. API: `GET /api/v1/algo-settings`, `PUT /api/v1/algo-settings/:name`; accounts carry the size they are checked against (`accountSize`), instance details the check (`accountSizeCheck`); both come from the database, without a broker query.
- Home-screen icons for iPhone and Android: a web manifest (`manifest.webmanifest`), the Apple touch icon, a 192 px icon and a maskable 512 px icon for Android's adaptive shapes; "Add to Home Screen" opens wickwatch without the browser bar.
- Market hours: the instance tables (overview, account page) get a **Market** column (Open, Closing soon in the last 30 minutes, Closed) for the symbol of each instance, the instance page the same badge next to the status. Hovering or tapping the badge shows the weekly trading hours in local time and the next opening or closing. From the broker's weekly schedule, without holidays; wickwatch asks at most once a day per account and symbol, in the background. cTrader: `sessions <symbol>` in the account's shell session. Adapter API: optional `BrokerAdapter.marketHours()`, `InstanceSummary.marketHours`.
- Parameter templates can be edited: **Edit** on the Algos page opens name and values in the instance form's parameter list. Parameters the template does not set stay out unless changed; values the newest algo version no longer knows are kept. Replaces the rename dialog. API: `GET /api/v1/parameter-templates/:id`.

### Changed
- The daily summary reads better in chats: a block per account (name, balance and equity, today's P&L with positions and instances, the challenge with one rule per line), separated by blank lines. Telegram gets it, and the alerts, as HTML: headings bold, account numbers as code, so Telegram no longer turns them into phone links.

### Fixed
- Tooltips in tables (e.g. the trade info buttons) were cut off at the table's edge; inside an element that clips they are now placed on the window.

## 0.3.1 – 2026-10-02

### Changed
- Helper containers of the cTrader CLI get readable names instead of random Docker ones: `wickwatch-session-<account>-<random>` for an account's shell session, `wickwatch-accounts-…`, `wickwatch-symbols-…` and `wickwatch-metadata-…` for single calls (the label prefix comes first).

### Fixed
- An account opened after wickwatch started (e.g. a new challenge) was offered as inactive when adding it: the cTrader CLI shell lists the active accounts as of its login, and the list came from a long-running session. It now comes from a fresh one.
- A cTrader CLI session whose process stopped answering without its end being reported (e.g. its helper container killed from outside) blocked its account until wickwatch was restarted; every query ran into the 60 s timeout. The session now counts as ended at its first timeout and is replaced.
- Behind docker-socket-proxy, a helper container that ended after running for more than 10 minutes was never noticed: the proxy drops the idle wait for its exit without an error. A tool now also ends with the end of its output, and is killed when no exit code comes.

## 0.3.0 – 2026-10-02

### Added
- Parameter templates: named parameter values of an algo, for every instance of it, on any account and timeframe. Save one from any configuration version ("Save as template…", the same name replaces it) or from a `.cbotset` on the Algos page, where templates are listed, renamed and deleted. "Apply template…" on the Configuration tab shows each value it changes, lets you keep current ones (e.g. an account's licence key), lists what does not fit the algo version, and saves the rest as a new version; the instance form loads a template like a parameter file. Values are encrypted at rest and visible to admins only; saving, changing, deleting and applying are audit-logged (`parameter_template.*`, the template's name in `instance.config`). API: `/api/v1/parameter-templates`.

## 0.2.0 – 2026-10-02

### Added
- API tokens for scripts and external clients (user menu → *API tokens*, admins): sent as `Authorization: Bearer <token>`, stored only as a hash and shown once, with a role (viewer or admin) and an optional lifetime; deletable, with the last use shown. A token acts as its creator with at most its role and cannot reach the login, password, 2FA or token endpoints; the audit log names the token an action came through. The password change can delete the user's tokens along with it, and `ALERT_WEBHOOK_URL` gets an `api_token_created` notice for every new token. Creating a token asks for the password and, with 2FA on, a code; `API_TOKENS_REQUIRE_2FA=on` (default off) allows it only to users with 2FA.
- Read-only MCP endpoint at `<base>/mcp` (Model Context Protocol, Streamable HTTP) for AI clients with an API token: overview, alerts, accounts with challenge status, instances with deals and key figures, logs, host status, and the audit log for admin tokens. See `docs/MCP.md`; `MCP=off` switches it off.

### Changed
- Empty lists on the algo, audit log and API token pages show their text inside a panel instead of loose on the page.

## 0.1.2 – 2026-10-01

### Added
- Parameter form: the filter "Only missing" next to "Only changed" lists the required values that are still empty, with their count (cTrader: text parameters).
- Larger log view with a search that marks the matches; both log views keep 1000 lines (was 500).
- Log download as a text file for the last 24 hours, the last 7 days or everything the runtime still has (`GET /instances/:ref/logs/download`), open to viewers like the live log.
- The instance table (overview, account page) opens a row's log, also for viewers.
- The trade details drawer steps to the previous and next trade with its arrows or the up and down keys.
- Action buttons show a spinner while their action runs.

### Changed
- P&L chart and live log sit side by side at the same height.
- The repository and the Docker image are public: `deploy/INSTALL.md` no longer needs a GHCR login, and the README starts the published image.

### Fixed
- Following the live log no longer stops once the buffer is full.
- An account without a name shows its number once instead of "number · number".
- While a dialog is open the page behind it no longer scrolls.

## 0.1.1 – 2026-10-01

### Added
- `deploy/INSTALL.md`: a step-by-step install on a Linux server behind nginx-proxy with the cTrader CLI adapter.

### Changed
- Notifications for a resolved alert say what is fine again ("Resolved: ger40-demo is running again") instead of repeating the alert, and "Closed: … was removed" when the instance or account was deleted.
- An instance stopped on purpose through wickwatch (stop, emergency stop, loss guard, a version applied without starting) raises no "is stopped" alert any more; a bot that stopped itself still does.

### Fixed
- The accounts offered by the broker list the selectable ones first, inactive ones last.
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

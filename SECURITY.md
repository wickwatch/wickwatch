# Security policy

Wickwatch handles broker credentials and can close positions. Please report vulnerabilities **privately** via GitHub's "Report a vulnerability" (Security tab → Private vulnerability reporting). Do not open public issues for security problems.

Include steps to reproduce, affected version and impact. We aim to respond within 14 days. There is no bug bounty.

## How Wickwatch protects your data

- **Login:** built-in accounts with password (scrypt) and optional, recommended TOTP (two-factor authentication), which can be switched on or off per user under *Profile* (switching off needs the password and a current code). The password is changed there too; it needs the current one, and the user's other sessions are logged out. Failed logins are rate-limited (10 per minute per IP) and written to the audit log; an unknown user and a wrong password get the same answer. When 2FA is on, the code is asked for only after the right password.
- **First run:** while no user exists, the server prints a one-time **setup token** to its log. Only someone with access to the log can create the admin.
- **Sessions:** random tokens in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` over HTTPS), stored only as a hash. They end after 12 hours without use and after 7 days at the latest. State-changing requests from other origins are rejected.
- **Roles:** `admin` may act (start/stop, emergency stop, credentials, accounts); `viewer` may only read.
- **Secrets at rest:** broker credentials, TOTP secrets and the parameter values of instance configurations (they may hold licence keys) are encrypted with AES-256-GCM using `MASTER_KEY`, so database backups hold them only encrypted. Credentials and TOTP secrets are never returned by the API; parameter values only to admins. None of them are logged.
- **Docker access** (docker runtime adapter): only through a docker-socket-proxy with the minimum permissions, never the raw socket.
- **Audit log:** logins and logouts, setup, password and 2FA changes, instance actions (start, stop, create, configuration versions, deploy and delete also when they fail, parameter file downloads), automatic restarts after a host restart, emergency stops and the loss guard, closed positions and cancelled orders, trade attribution changes, algo uploads and deletions, challenge profiles, and changes to credentials and accounts. Kept for `AUDIT_RETENTION_DAYS`.

## Outbound connections

Wickwatch itself connects only to:
- the broker, through its adapter (cTrader CLI: Spotware's servers);
- the Docker API through the socket proxy, which pulls the pinned images (e.g. `ghcr.io/spotware/ctrader-console`);
- `ALERT_WEBHOOK_URL` and `HEARTBEAT_URL`, if set (alerts and the daily summary);
- `CLOCK_CHECK_URL` once an hour with the Docker runtime (default `https://www.cloudflare.com/cdn-cgi/trace`; it sends no data, only reads the time). Set it to `off` to avoid it.

No telemetry, no update checks. The web app loads nothing from third parties; its fonts are bundled.

## Operating it safely

- Keep Wickwatch off the public internet if you can (VPN such as Tailscale or WireGuard). Otherwise use TLS via a reverse proxy and set `TRUST_PROXY`.
- Back up `MASTER_KEY` separately from the database backup. A database without its key is useless, and a key with the database gives access to the stored credentials.
- The API docs (`/api/docs`) require a login; `/healthz` is public and reveals only status and version.

## Lost access

There is no password reset by e-mail. To start over, stop Wickwatch and delete the users from the database; on the next start the setup token is printed again. Accounts and stored credentials are kept.

```sh
sqlite3 data/wickwatch.db "DELETE FROM users;"
```

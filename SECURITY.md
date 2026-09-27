# Security policy

Wickwatch handles broker credentials and can close positions. Please report vulnerabilities **privately** via GitHub's "Report a vulnerability" (Security tab → Private vulnerability reporting). Do not open public issues for security problems.

Include steps to reproduce, affected version and impact. We aim to respond within 14 days. There is no bug bounty.

## How Wickwatch protects your data

- **Login:** built-in accounts with password (scrypt) and mandatory TOTP. Failed logins get one generic answer, are rate-limited (10 per minute per IP) and written to the audit log.
- **First run:** while no user exists, the server prints a one-time **setup token** to its log. Only someone with access to the log can create the admin.
- **Sessions:** random tokens in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` over HTTPS), stored only as a hash. They end after 12 hours without use and after 7 days at the latest. State-changing requests from other origins are rejected.
- **Roles:** `admin` may act (start/stop, emergency stop, credentials, accounts); `viewer` may only read.
- **Secrets at rest:** broker credentials and TOTP secrets are encrypted with AES-256-GCM using `MASTER_KEY`. The API never returns them and they are never logged.
- **Docker access** (docker runtime adapter): only through a docker-socket-proxy with the minimum permissions, never the raw socket.
- **Audit log:** logins, setup, instance actions, emergency stops and changes to credentials and accounts.

## Operating it safely

- Keep Wickwatch off the public internet if you can (VPN such as Tailscale or WireGuard). Otherwise use TLS via a reverse proxy and set `TRUST_PROXY`.
- Back up `MASTER_KEY` separately from the database backup. A database without its key is useless, and a key with the database gives access to the stored credentials.
- The API docs (`/api/docs`) require a login; `/healthz` is public and reveals only status and version.

## Lost access

There is no password reset by e-mail. To start over, stop Wickwatch and delete the users from the database; on the next start the setup token is printed again. Accounts and stored credentials are kept.

```sh
sqlite3 data/wickwatch.db "DELETE FROM users;"
```

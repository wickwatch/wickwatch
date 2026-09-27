# Deployment examples

Pick one:

| File | When |
| --- | --- |
| `compose.standalone.yml` | Own port, TLS yourself or inside a VPN |
| `+ compose.nginx-proxy.yml` | You run nginx-proxy / acme-companion |
| `+ compose.traefik.yml` | You run Traefik |

Bot instances are not defined here: Wickwatch creates them through the runtime adapter.

The container runs as user `node` (UID 1000). Create the data folder before the first start so the database can be written: `mkdir -p data && sudo chown 1000:1000 data`.

`/healthz` answers at the root and under `BASE_PATH`, without auth, for proxy health checks and external monitoring.

## First start
1. Set `MASTER_KEY` (`openssl rand -base64 32`) and keep a backup: without it, stored credentials cannot be decrypted.
2. Start the stack and read the log: `docker compose logs wickwatch | grep "setup token"`.
3. Open `<BASE_PATH>/setup`, enter the token, create the admin account and scan the QR code with an authenticator app.
The token is valid until the admin exists; after a restart without an admin, a new one is printed.

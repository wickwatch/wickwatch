# Deployment examples

Pick one:

| File | When |
| --- | --- |
| `compose.standalone.yml` | Own port, TLS yourself or inside a VPN |
| `+ compose.nginx-proxy.yml` | You run nginx-proxy / acme-companion |
| `+ compose.traefik.yml` | You run Traefik |

Bot instances are not defined here. There are two ways, and both can be mixed:

- **Set them up in wickwatch** (`RUNTIME_ADAPTER=docker`, `BROKER_ADAPTER=ctrader-cli`, `CONFIG_ADAPTER=cbotset`): upload the algo, create an instance, and wickwatch creates, replaces and removes its container (label `wickwatch.managed=true`) from the saved configuration, with the image pinned in `CTRADER_IMAGE`.
- **Define them yourself** in your own compose file: wickwatch shows and controls every container that carries the label `wickwatch.instance` (plus `wickwatch.account`, `wickwatch.symbol`, `wickwatch.period` …; how trades are attributed to instances: `wickwatch.attribution` and `wickwatch.order-label`, see [`docs/BOT-CONTRACT.md`](../docs/BOT-CONTRACT.md)). It never replaces or removes such containers.

**After a host or Docker restart**, Docker's `on-failure` policy does not bring bots back: they received SIGTERM and ended cleanly. wickwatch starts the instances it set up again if they were meant to run (see `INSTANCE_RESTART_POLICY` in [`docs/CONFIGURATION.md`](../docs/CONFIGURATION.md)). So wickwatch itself must come back after a reboot: keep `restart: unless-stopped` for its container. Containers from your own compose file follow their own restart policy.

For the cTrader CLI adapter (`BROKER_ADAPTER=ctrader-cli`, `RUNTIME_ADAPTER=docker`), the wickwatch image does not need the CLI: its own queries run in short-lived containers of `CTRADER_IMAGE` (`CTRADER_CLI=container`, the default in the image), through the same socket proxy. They carry the label `wickwatch.tool` and remove themselves.

The container runs as user `node` (UID 1000). Create the data folder before the first start so the database can be written: `mkdir -p data && sudo chown 1000:1000 data`.

`/healthz` answers at the root and under `BASE_PATH`, without auth, for proxy health checks and external monitoring.

## First start
1. Set `MASTER_KEY` (`openssl rand -base64 32`) and keep a backup: without it, stored credentials cannot be decrypted.
2. Start the stack and read the log: `docker compose logs wickwatch | grep "setup token"`.
3. Open `<BASE_PATH>/setup`, enter the token, create the admin account and scan the QR code with an authenticator app.
The token is valid until the admin exists; after a restart without an admin, a new one is printed.

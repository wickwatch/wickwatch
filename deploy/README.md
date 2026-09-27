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

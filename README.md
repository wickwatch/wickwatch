<p align="center">
  <img src="assets/logo/wickwatch-logo-horizontal-dark.svg" alt="Wickwatch" width="420">
</p>

**Wickwatch** is a self-hosted dashboard to monitor and control trading bots: see what runs where and with which parameters, start and stop instances, follow positions and deals live, and keep prop-firm challenge limits in view.

> **Status:** early development. Login with TOTP works; data comes from the demo adapter, broker and Docker adapters are not there yet.

## Try it
Wickwatch starts with a **demo adapter**: fake accounts, instances, positions and logs, so you can look around without a broker or bots.

With Docker:

```sh
docker build -t wickwatch .
docker run --rm -p 3000:3000 -e MASTER_KEY="$(openssl rand -base64 32)" -v wickwatch-data:/app/data wickwatch
```

Or from source (Node 24+, pnpm), see [`CONTRIBUTING.md`](CONTRIBUTING.md#development).

Then:
1. Copy the **setup token** from the log line `No admin yet. Open /setup and enter the setup token: …`.
2. Open http://localhost:3000, enter the token, choose a user name and scan the QR code with an authenticator app (e.g. Aegis, 2FAS, Google Authenticator).
3. Set a password and enter the current code. The overview with demo data opens.

The API is described with OpenAPI: [`docs/openapi.json`](docs/openapi.json) in the repo, interactive docs at `/api/docs` after login. Deployment behind a reverse proxy: [`deploy/`](deploy/README.md). All settings: [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

## Planned features (phase 1)
- Instance overview with start, stop, restart, edit and create
- Instance detail: parameters, open positions and orders, history, equity curve, live logs
- Accounts with optional prop-challenge profiles (profit target, daily loss, max drawdown, trading days)
- Emergency stop per account, audit log, parameter and algo versioning with rollback
- Dark and light mode, English and German
- Deploy standalone, behind nginx-proxy, Traefik or any reverse proxy

## Architecture
A strategy- and broker-neutral core talks to pluggable adapters:

| Adapter | First implementation |
| --- | --- |
| Runtime (run, stop, logs) | Docker |
| Broker (accounts, positions, deals, metadata) | cTrader CLI |
| Config (parameter files) | `.cbotset` / `.optset` |

See [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/ADAPTERS.md`](docs/ADAPTERS.md). Security model: [`SECURITY.md`](SECURITY.md).

## About the name
A *wick* is the thin line above and below a candlestick that shows how far price moved. *Wickwatch* keeps watch over your trading bots, down to every wick.

## Contributing
Contributions are welcome, see [`CONTRIBUTING.md`](CONTRIBUTING.md). Commits must be signed off (DCO).

## Disclaimer
Wickwatch is a monitoring and control tool, not financial advice. Trading involves risk; you are responsible for your bots and accounts. cTrader is a trademark of its respective owner; Wickwatch is not affiliated with or endorsed by Spotware.

## License
[AGPL-3.0](LICENSE)

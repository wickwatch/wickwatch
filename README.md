<p align="center">
  <img src="assets/logo/wickwatch-logo-horizontal-dark.svg" alt="Wickwatch" width="420">
</p>

**Wickwatch** is a self-hosted dashboard to monitor and control trading bots: see what runs where and with which parameters, start and stop instances, follow positions and deals live, and keep prop-firm challenge limits in view.

> **Status:** early development. Runs with demo data only; broker and Docker adapters are not there yet.

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

See [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/ADAPTERS.md`](docs/ADAPTERS.md).

## About the name
A *wick* is the thin line above and below a candlestick that shows how far price moved. *Wickwatch* keeps watch over your trading bots, down to every wick.

## Contributing
Contributions are welcome, see [`CONTRIBUTING.md`](CONTRIBUTING.md). Commits must be signed off (DCO).

## Disclaimer
Wickwatch is a monitoring and control tool, not financial advice. Trading involves risk; you are responsible for your bots and accounts. cTrader is a trademark of its respective owner; Wickwatch is not affiliated with or endorsed by Spotware.

## License
[AGPL-3.0](LICENSE)

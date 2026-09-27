# Wickwatch brand & style guide

Short on purpose: enough to keep the dashboard, docs and repo consistent. Design tokens live in [`design/tokens.json`](design/tokens.json) and are generated into [`design/tokens.css`](design/tokens.css). Always use the tokens, never hard-coded colour values. Logo files and logo rules: [`assets/logo/README.md`](assets/logo/README.md).

## Name
A *wick* is the thin line above and below a candlestick that shows how far price moved. *Wickwatch* keeps watch over your trading bots, down to every wick. Write it as **Wickwatch** in text, **wickwatch** only in the wordmark, package and repo names.

## Colour modes
Wickwatch ships with a **dark** and a **light** mode. The system preference decides by default; the header switch overrides it (`data-theme="dark"` or `"light"` on `<html>`). Every screen must work in both.

| Role | Token | Dark | Light |
| --- | --- | --- | --- |
| Page background | `--ww-bg` | `#0F1318` | `#F7F6F2` |
| Cards, panels | `--ww-surface` | `#171C23` | `#FFFFFF` |
| Buttons, raised areas | `--ww-surface-raised` | `#1E252E` | `#F1EFE9` |
| Logs, code, charts | `--ww-inset` | `#0B0E12` | `#F1EFE9` |
| Borders | `--ww-border` / `--ww-border-strong` | `#262D37` / `#353D48` | `#E2DED5` / `#CFCAC0` |
| Text | `--ww-text` | `#E7EAEE` | `#1B2230` |
| Secondary text | `--ww-text-muted` | `#9AA3AF` | `#5B6470` |
| Primary action | `--ww-accent` + `--ww-on-accent` | `#E8A33D` / `#15110A` | `#E8A33D` / `#15110A` |
| Links | `--ww-link` | `#E8A33D` | `#9A5E0C` |
| Data, info, focus ring | `--ww-info`, `--ww-focus` | `#5AA9E6` | `#2A6FAA` |

All text colours reach at least 4.5 : 1 contrast on their surface in both modes.

## Status colours
Used for bot status, P&L and challenge limits.

| Meaning | Token (text / background) | Dark | Light |
| --- | --- | --- | --- |
| Running, profit, OK | `--ww-positive` / `--ww-positive-bg` | `#3DBE8B` / `#15302A` | `#1C7A55` / `#E3F4EC` |
| Stopped, loss, limit breached | `--ww-negative` / `--ww-negative-bg` | `#F07152` / `#2A1714` | `#B83E24` / `#FBE8E3` |
| Warning, near a limit | `--ww-warning` / `--ww-warning-bg` | `#E8C33D` / `#29240F` | `#8A6A00` / `#FBF3D6` |

**Colour never carries meaning alone.** Always pair it with text ("Running", "Stopped"), a sign (+ / −) or an icon, so the dashboard works for colour-blind users and in greyscale screenshots.

## Typography

| Use | Font | Token |
| --- | --- | --- |
| Logo, page titles | Space Grotesk (Bold / Regular) | `--ww-font-display` |
| UI and body text | IBM Plex Sans | `--ww-font-body` |
| Numbers, prices, IDs, logs | IBM Plex Mono | `--ww-font-mono` |

Sizes: 12, 13, 14 (default), 16, 18, 20, 28, 36 px (`--ww-size-*`). Numbers in tables are right-aligned and use the mono font so digits line up. Format numbers, currencies and dates with `Intl` for the active locale.

## Spacing, shape, interaction
- Spacing scale 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 px (`--ww-space-*`).
- Radii: 6 px small controls, 8 px buttons and inputs, 12 px panels, 16 px cards, full for pills (`--ww-radius-*`).
- Touch targets at least 44 px (`--ww-touch-target`), important for the mobile view and the emergency stop.
- Destructive actions (emergency stop, close position, delete) use the negative colour and always ask for confirmation.
- Visible focus ring in `--ww-focus` on every interactive element.

## Voice
- Factual and short. Say what happened and what the user can do: "Login failed – check the password for account 1111111."
- No promises about profits, no hype, no financial advice.
- Numbers first, adjectives last.
- English is the source language; German is the first translation. Keep UI strings in the i18n files, never in components.

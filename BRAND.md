# Wickwatch brand & style guide

Short on purpose: enough to keep the dashboard, docs and repo consistent. Design tokens live in [`design/tokens.json`](design/tokens.json) and are generated into [`design/tokens.css`](design/tokens.css). Always use the tokens, never hard-coded colour values; the only exceptions are the logo and the language flags in [`assets/flags`](assets/flags). Logo files and logo rules: [`assets/logo/README.md`](assets/logo/README.md).

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

## Buttons and icons
Line icons on a 24 px grid, stroked in `currentColor` (`apps/web/src/icons.ts`, rendered by `AppIcon`); no icon font, no library. Buttons with an icon use `IconButton`.
- **Icon only**, with the label as tooltip and accessible name: actions repeated in every row (tables, history) and the compact header controls.
- **Icon and text**: the primary actions of a page (edit, save, start) and destructive actions outside table rows (delete, emergency stop), so a tap is never a guess.
- Destructive row actions (close position, cancel order) are icon only in the negative colour, with tooltip; they always ask for confirmation first.
- Button sizes come from tokens (`--ww-control`, `--ww-control-sm`), a little larger on touch screens; never below the 24 px minimum target. Row actions stay on one line.
- Tooltips use `data-tooltip` (shown at once on hover and focus), not the native `title`. A row action names its row ("Restart: alpha-ger40"), since the name is far away at the start of the row. A disabled action says why in a tooltip on a wrapper (a disabled button gets no focus).
- A status shown as an icon only (e.g. the server time in the header) changes its shape with the state, not only its colour (clock, exclamation mark, cross, question mark), and says in its tooltip what was found and why it matters; the same text is there for screen readers. Long tooltips use `data-tooltip-wrap` and may break into lines: the finding first, the explanation below.
- Action columns in tables are right-aligned.
- Choices from a short list (language, theme) and secondary actions ("more") open a menu (`MenuButton`); the chosen entry shows a check mark.

## Consistency
- The same kind of action behaves the same everywhere. Adding something (account, login, algo, challenge profile) is a button that opens a modal.
- Page heads: title and actions in one row, the intro or meta line below at full width. On phones the actions show their icon only (`IconButton collapse`), so they stay next to the title instead of wrapping below the text.
- Details of a table row (position, order, trade) open in a drawer at the right edge (`AppModal` with `drawer`; the same bottom sheet as a modal on phones), from an info button in the row.
- Loading states show the spinner (`AppSpinner`: the logo symbol with its radar turning; the plain symbol with reduced motion), not a "Loading …" text. Screen readers still get the text.
- Optional detail (the rules of a challenge on an account card, parameter groups) folds away behind a disclosure with a chevron; it opens by itself when something needs attention.
- If a shared component exists (icon button, menu, modal and drawer, spinner, file drop zone, parameter list, trade tables, status badge, banner), use it; no local look-alikes.
- Deviate only for a good reason, and say why in a code comment where the deviation lives.

## Voice
- Factual and short. Say what happened and what the user can do: "Login failed – check the password for account 1111111."
- No promises about profits, no hype, no financial advice.
- Numbers first, adjectives last.
- English is the source language; German is the first translation. Keep UI strings in the i18n files, never in components.

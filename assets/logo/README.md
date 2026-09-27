# Wickwatch – Logo

## About the name
A *wick* is the thin line above and below a candlestick that shows how far price moved. *Wickwatch* keeps watch over your trading bots, down to every wick.

## Files

| File | Use |
| --- | --- |
| `wickwatch-symbol-{dark,light}.svg` | Symbol for dark / light backgrounds |
| `wickwatch-symbol-mono-{black,white}.svg` | Single-colour symbol |
| `wickwatch-logo-horizontal-*.svg` | Symbol + wordmark side by side |
| `wickwatch-logo-stacked-*.svg` | Symbol above wordmark |
| `favicon.svg`, `favicon-16.png`, `favicon-32.png`, `favicon.ico` | Browser favicon, pixel-aligned; `favicon.svg` adapts to dark/light browser UI |
| `apple-touch-icon.png` (180 px, square – iOS rounds the corners), `icon-512.png`, `app-icon.svg` | App / home-screen icon (full symbol) |
| `social-preview.png` (1280 × 640) | GitHub repository social preview |

`dark` means *for dark backgrounds*, `light` means *for light backgrounds*.

## HTML head

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## Colours

| Name | Hex |
| --- | --- |
| Amber | `#E8A33D` |
| Blue (on dark) | `#5AA9E6` |
| Blue (on light) | `#2F7FC1` |
| Line (on dark) | `#E7EAEE` |
| Ink (on light) | `#1B2230` |
| Background dark | `#0F1318` |

## Rules
- Keep clear space of at least a quarter of the symbol's diameter around it.
- Minimum size of the full symbol: 24 px. Below that, use the favicon.
- Wordmark: Space Grotesk, "wick" Bold, "watch" Regular. The text is converted to outlines, no font needed.
- Do not rotate, distort, recolour outside the palette or add shadows.

Space Grotesk is licensed under the SIL Open Font License 1.1.

# Accessibility

wickwatch should be usable with a keyboard, a screen reader, on a small screen and without relying on colour. This page says what the project does for that, where it falls short, and how to report a barrier.

## What we aim for

The goal is to follow the [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) at level AA. This is an aim, not a claim of conformance: wickwatch has not been audited (see [Known limitations](#known-limitations)).

## What is built in

These are rules of the design ([`BRAND.md`](BRAND.md)) that every change has to keep:

- **Contrast:** all text colours reach at least 4.5 : 1 on their surface, in dark and in light mode.
- **Colour never carries meaning alone:** a status always comes with text, a sign (+/−) or a shape of its own. A status shown as an icon only changes its shape with the state, not just its colour.
- **Keyboard:** every interactive element shows a visible focus ring. The details of a table row open from an info button as well as from a click on the row; Escape closes dialogs and drawers, and the arrow keys step to the previous and next row.
- **Names for screen readers:** buttons that show only an icon carry their label as accessible name, and a row action names its row ("Restart: alpha-ger40"). Tooltips appear on focus as well as on hover and carry the same text for screen readers. Loading states have a text, and a button whose action is running is marked as busy.
- **Charts:** the realised P&L curve carries a text summary for screen readers, and the arrow keys step through its points; the key figures next to it and the trade history below give the numbers as text.
- **Touch:** targets are at least 44 px, also for the emergency stop; a tooltip that is the only way to a piece of information can be pinned open with a tap.
- **Motion:** animations are reduced or switched off when the system asks for reduced motion.
- **Language:** the page declares its language (English or German) and follows the browser's language by default.
- **Destructive actions** (emergency stop, close position, delete) always ask for confirmation, so a slip of the key or the finger does not trade.

## Supported environments

wickwatch is a web app for current versions of Chrome, Edge, Firefox and Safari, on desktop and on phones. It works in dark and light mode and follows the system setting by default.

## Known limitations

- **No audit.** wickwatch has not been checked against WCAG by an accessibility specialist, and there are no automated accessibility tests in the test suite yet.
- **Little testing with assistive technology.** It is developed with keyboard and pointer; testing with screen readers has not been systematic. Expect rough edges, especially in the live log, in tables that update while you read them, and in the parameter form of an instance.
- **Languages.** The interface is in English and German only.
- **API docs.** The interactive API documentation at `/api/docs` comes from a third-party component and has not been checked.

## Report a barrier

If something keeps you from using wickwatch, please tell us:

- open an [issue](https://github.com/wickwatch/wickwatch/issues/new/choose) and say what you tried to do, what happened, and which browser and assistive technology you use, or
- write to mohrwurm@gmail.com if you prefer not to post in public.

wickwatch is a hobby project, so there is no response time we can promise, but barriers are treated as bugs, not as feature requests.

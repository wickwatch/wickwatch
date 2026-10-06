## What and why

<!-- What does this change, and what is it for? Link the issue if there is one. -->

## Checklist

- [ ] `pnpm check` passes (format, lint, typecheck, tests)
- [ ] Every commit is signed off (`git commit -s`, DCO) and follows Conventional Commits
- [ ] UI strings are in `i18n/en.json` and `i18n/de.json`; colours come from design tokens; dark and light mode both work
- [ ] No cTrader or strategy specifics in core code (they live in adapters)
- [ ] Docs updated where behaviour, settings or the API changed (`docs/`, `CHANGELOG.md`, `docs/openapi.json`)
- [ ] No secrets, real account numbers or credentials in code, tests or screenshots

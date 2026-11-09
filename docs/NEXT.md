# Next

## Goal

savetab reaches OneTab 2.24 feature parity in Chrome and Firefox (`docs/specs/features.md`), then syncs across devices through a multi-user Postgres server (`docs/plans/onetab-parity.md`, P4).

## Next steps

- Build P3 (`docs/plans/onetab-parity.md`) from step 2 (locales), in step order. Step 1 is built.
- The Firefox GUI check has not covered P2 multi-select, sort, collapse, paging, or keyboard navigation. Chromium e2e covers them.

## Pointers

- State checked at handoff: 64 core tests, 15 extension unit tests, and 26 Chromium e2e tests pass. `pnpm check` and `pnpm lint` pass. `oxfmt --check` fails only on `DESIGN.md`, `docs/plans/onetab-parity.md`, `docs/specs/features.md`, and `package.json`. P2 steps 1-10 are built. At `4ff39ab` the Firefox GUI check passed for the toolbar save, folder column, item menus, move dialog, search, omnibox `11`, Tasks view, quick list, and "Send this tab to".
- The repo has no git remote. Nothing is pushed.

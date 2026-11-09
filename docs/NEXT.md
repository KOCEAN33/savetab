# Next

## Goal

savetab reaches OneTab 2.24 feature parity in Chrome and Firefox (`docs/specs/features.md`), then syncs across devices through a multi-user Postgres server (`docs/plans/onetab-parity.md`, P4).

## Next steps

- Build P3 step 2, locales (`docs/plans/onetab-parity.md`, P3 step 2), then steps 3-10 in order. Done when the step 2 check passes (e2e sets `language: 'ko'` and reads the Korean page total and a Korean group menu entry, and a unit test shows `en.json` and `ko.json` have the same keys), plus `pnpm test`, `pnpm test:e2e`, `pnpm check`, and `pnpm lint`.
  - Step 1 is built at `35171a2`: `GroupFields.openAs` and `restoreTarget` with `groupDefaults` filled in by `ListView`, synced `tabGroupRestore` and `discardOnOpen`, device `theme` and `language`, `toolbarAction: 'popup'` (type only), `NewTab.pinned` writing `pinOnOpen`.
  - The user reviews the Korean strings step 2 writes: wording and terms are their call.

## Pointers

- State checked at handoff: 64 core tests, 15 extension unit tests, and 26 Chromium e2e tests pass. `pnpm check` and `pnpm lint` pass. `oxfmt --check` fails only on `DESIGN.md`, `docs/plans/onetab-parity.md`, `docs/specs/features.md`, and `package.json`, as before this session.
- The user keeps P3 research inside this repo for now (`docs/specs/browser-apis.md`), not in the vault.
- The repo has no git remote. Nothing is pushed.

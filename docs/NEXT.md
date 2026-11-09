# Next

## Goal

savetab reaches OneTab 2.24 feature parity in Chrome and Firefox (`docs/specs/features.md`), then syncs across devices through a multi-user Postgres server (`docs/plans/onetab-parity.md`, P4).

## Next steps

- Build P2 step 9, Tasks view and quick list, as `docs/plans/onetab-parity.md` specifies. `quickOrder` already exists on every item (`packages/core/src/model.ts`), with no UI yet. Done when the step's e2e check passes plus `pnpm test`, `pnpm test:e2e`, `pnpm check`, `pnpm lint`.
- Build P2 step 10, "Send this tab to" in the context menu. `apps/extension/lib/recent.ts` already holds the device's recent list, which `touchRecent` updates when the move dialog targets a group. Done when the step's check passes plus the four commands above.
- Run the Firefox GUI check (`docs/guides/firefox-check.md`) over the P2 pages: folder column, item menus, move dialog, search, omnibox `11`. Only Chromium e2e has run for P2. Done when each works in Firefox or a failure is written down.

## Pointers

- State checked at handoff: 57 core tests, 14 extension unit tests, and 23 Chromium e2e tests pass. `pnpm check` and `pnpm lint` pass. The tree is clean at `d05b17c`.
- The repo has no git remote. Nothing is pushed.
- Steps 1-8 changed the plan in three places, recorded in the plan itself: group merge drops on the folder column, sorting sits in the folder bar, and archived rows use a flat background.

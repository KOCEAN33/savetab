# Next

## Goal

savetab reaches OneTab 2.24 feature parity in Chrome and Firefox (`docs/specs/features.md`), then syncs across devices through a multi-user Postgres server (`docs/plans/onetab-parity.md`, P4).

## Next steps

- P2 has no step order yet. Expand the P2 section of `docs/plans/onetab-parity.md` into ordered steps with done-when checks, leading with the data model change: titles and notes move to `Link` records keyed by normalized URL, shared by all copies. Done when the plan lists each P2 feature from `features.md` under a step.
- Build P2 in that order. Folders already exist in the model (`packages/core/src/model.ts`, `parentId`), with no UI yet. Done when each step's check passes plus `pnpm test`, `pnpm test:e2e`, `pnpm check`, `pnpm lint`.

## Pointers

- State checked at handoff: 29 core tests, 8 extension unit tests, 7 Chromium e2e tests pass. A Firefox GUI run stored 3 tabs and restored one.
- The repo has no git remote. Nothing is pushed.

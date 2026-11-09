# Next

## Goal

savetab reaches OneTab 2.24 feature parity in Chrome and Firefox (`docs/specs/features.md`), then syncs across devices through a multi-user Postgres server (`docs/plans/onetab-parity.md`, P4).

## Next steps

- Run the Firefox GUI check (`docs/guides/firefox-check.md`) over the P2 pages: folder column, item menus, move dialog, search, omnibox `11`, Tasks view, quick list, and the "Send this tab to" context submenu. Only Chromium e2e has run for P2. Done when each works in Firefox or a failure is written down.
  - Blocker: every `orca computer` AX read fails with `permission_denied` "has visible windows but no accessibility window", on Finder as well as Firefox. `--restore-window` and coordinate clicks fail the same way. `orca computer permissions` still reports accessibility granted. The user plans to toggle Orca Computer Use off and on in System Settings > Privacy & Security > Accessibility. Guess: the grant is stale. Before starting web-ext, check that `orca computer get-app-state --app com.apple.finder` returns a snapshot.
  - Guide steps 1 (`pnpm build`, `web-ext lint`: 0 errors, the known innerHTML warning) and 2 (`web-ext run`) passed at `5db7914`.

## Pointers

- State checked at handoff: 61 core tests, 15 extension unit tests, and 26 Chromium e2e tests pass. `pnpm check`, `pnpm lint`, and `oxfmt --check` pass. P2 steps 1-10 are built.
- The repo has no git remote. Nothing is pushed.

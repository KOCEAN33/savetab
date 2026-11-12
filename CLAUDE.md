# savetab

A browser extension for Chrome and Firefox that stores open tabs as a list, with OneTab's features minus the ones `docs/specs/features.md` lists as out of scope, and its own UI. Self-hosted multi-device sync on Postgres comes later.

Feature target: `docs/specs/features.md`, Chrome and Firefox API differences: `docs/specs/browser-apis.md`, plan and data model: `docs/plans/onetab-parity.md`, UI decisions: `DESIGN.md`, Firefox check: `docs/guides/firefox-check.md`, releases and install: `docs/guides/release.md`, store listing: `docs/guides/store-registration.md`, deferred work and items waiting on the user: `docs/candidates.md`, handoff with the open next steps: `docs/NEXT.md`, sync server and its deployment: `apps/server/README.md`. Read before changing shape.

- Every list write goes through a `@savetab/core` mutation inside `transact` (`apps/extension/lib/db.ts`), so the outbox records it for sync.
- A mutation runs after its UI event finishes dispatching, when `e.currentTarget` is null. Read event fields into locals before calling `act` or `transact`.
- Inside `transact`, await only IndexedDB work. Any other await, such as `crypto.subtle`, lets Dexie commit the transaction early.
- Sync state (the account, the pull cursor, the outbox) is read and written through the functions in `apps/extension/lib/db.ts`. A page joins or leaves an account there, and the background's `liveQuery` starts the cycle.
- TypeScript stays on 6.x. svelte-check 4 rejects TypeScript 7.
- E2E runs against the `--mode e2e` build, which exposes `globalThis.savetabTest` in the background. Production builds never expose it. `pnpm test:e2e` drives Chromium with Playwright, `pnpm test:e2e:firefox` drives Firefox with selenium-webdriver. `e2e/sync.spec.ts` starts the sync server through `apps/server/scripts/e2e-server.sh`, so `pnpm test:e2e` needs Go and the test Postgres of `apps/server/README.md`.
- UI text goes through `t` or `tn` (`apps/extension/lib/i18n.ts`). A new string adds its key to both `apps/extension/locales/en.json` and `ko.json`. A unit test fails when their keys differ.
- The list page has one action menu, `ItemMenu`, mounted by the page for the row in `menu` (`apps/extension/lib/ui.svelte.ts`). A row adds a button that calls `toggleMenu`, never its own menu or window listener.
- The extension icon source is `apps/extension/assets/icon.svg`. `apps/extension/public/icon/*.png` are renders of it at 16, 32, 48, 96, and 128px.
- CSS values come from `DESIGN.md` tokens in `apps/extension/styles/tokens.css`. `pnpm lint` enforces them with stylelint.
- `pnpm lint` also holds the module boundaries in `.oxlintrc.json` and the repo rules oxlint cannot express in `scripts/lint-conventions.mjs`. A new repo rule that a check can state goes into one of them.

Done means `pnpm test`, `pnpm test:e2e`, `pnpm test:e2e:firefox`, `pnpm check`, and `pnpm lint` all pass.

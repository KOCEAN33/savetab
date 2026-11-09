# savetab

A OneTab-parity browser extension for Chrome and Firefox. Self-hosted multi-device sync on Postgres comes later.

Feature target: `docs/specs/features.md`, plan and data model: `docs/plans/onetab-parity.md`, UI decisions: `DESIGN.md`. Read before changing shape.

- Every list write goes through a `@savetab/core` mutation inside `transact` (`apps/extension/lib/db.ts`), so the outbox records it for sync.
- TypeScript stays on 6.x. svelte-check 4 rejects TypeScript 7.
- E2E runs against the `--mode e2e` build, which exposes `globalThis.savetabTest` in the background. Production builds never expose it.
- CSS values come from `DESIGN.md` tokens in `apps/extension/styles/tokens.css`. `pnpm lint` enforces them with stylelint.

Done means `pnpm test`, `pnpm test:e2e`, `pnpm check`, and `pnpm lint` all pass.

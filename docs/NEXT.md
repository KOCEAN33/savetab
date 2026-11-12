# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

Continue P4 at step 5 of `docs/plans/onetab-parity.md` `### P4: sync server`: the sync client in the extension. Steps 1 to 4 are built. `apps/server` has every endpoint of the plan's "HTTP API" list. `packages/core` holds the op format, the merge rule, and the client crypto in `src/crypto.ts`. No code calls the server or the crypto yet. Server tests need the tailnet, see `apps/server/README.md`.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- P4 steps 6 to 9 follow step 5 in the plan's order.
- Step 6 needs a real OIDC issuer to log in against. None is chosen. The server tests use a fake one.

## Pointers

- Open UI findings and the question about pairing approval: `docs/candidates.md`.
- First-open time against OneTab: `apps/extension/scripts/first-open.mjs` measures both. savetab is the faster one.

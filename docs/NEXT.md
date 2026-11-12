# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

Continue P4 at step 4 of `docs/plans/onetab-parity.md` `### P4: sync server`: client crypto in `packages/core`. Steps 1 to 3 are built in `apps/server`: the op log, the wrapped key, the snapshot, the pairing relay, and the OIDC login with device tokens, which is every endpoint of the plan's "HTTP API" list. `core` holds the op format and the merge rule the client steps build on. Server tests need the tailnet, see `apps/server/README.md`.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- P4 steps 5 to 9 follow step 4 in the plan's order.

## Pointers

- Open UI findings and the question about pairing approval: `docs/candidates.md`.
- First-open time against OneTab: `apps/extension/scripts/first-open.mjs` measures both. savetab is the faster one.

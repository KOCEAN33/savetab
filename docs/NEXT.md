# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

Continue P4 at step 3 of `docs/plans/onetab-parity.md` `### P4: sync server`: OIDC login and device tokens in `apps/server`. Steps 1 and 2 are built: the Go server with the op log, the wrapped key, the snapshot, and the pairing relay, every endpoint of the plan's "HTTP API" list except `/v1/auth/*`. `core` holds the op format and the merge rule the client steps build on. Server tests need the tailnet, see `apps/server/README.md`.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- P4 steps 4 to 9 follow step 3 in the plan's order.

## Pointers

- Open UI findings and the question about pairing approval: `docs/candidates.md`.
- First-open time against OneTab: `apps/extension/scripts/first-open.mjs` measures both. savetab is the faster one.

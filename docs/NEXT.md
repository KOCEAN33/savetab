# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

Continue P4 at step 2 of `docs/plans/onetab-parity.md` `### P4: sync server`: the key, snapshot, and pairing relay endpoints in `apps/server`. Step 1 is built: the Go server with the op log, `POST` and `GET /v1/ops`. `core` holds the op format and the merge rule the client steps build on. Server tests need the tailnet, see `apps/server/README.md`.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- Measure the list page's first open against OneTab. The owner asked for a first open faster than OneTab, and no OneTab number exists. savetab paints its first groups about 130 ms after navigation with 3,000 stored tabs in 150 groups, measured in Playwright Chromium from navigation start to the frame after the first `.group` appears. Done when the same measurement on OneTab 2.24 with the same 3,000 links is recorded next to it, and savetab's number is the lower one.
- If savetab is not faster, cut the read: the page loads every record with `db.items.toArray()` in `apps/extension/entrypoints/onetab/App.svelte` before it draws. Done when the measurement above beats OneTab and the five commands in `CLAUDE.md` pass.

## Pointers

- Open UI findings and the question about pairing approval: `docs/candidates.md`.

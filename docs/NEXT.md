# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

Start P4, the sync server in `apps/server` (Go and Postgres). The owner queued it as the work after the UI redesign, and the redesign is committed. The design is `docs/plans/onetab-parity.md` `### P4: sync server`. `core` already holds the op format and the merge rule the server work builds on: `Op` with `v` and `kind`, `mergeRemote`, and `restoreSnapshot` replaying original clocks. The next piece is the server in `apps/server` and the P4 step order in the plan.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- Measure the list page's first open against OneTab. The owner asked for a first open faster than OneTab, and no OneTab number exists. savetab paints its first groups about 130 ms after navigation with 3,000 stored tabs in 150 groups, measured in Playwright Chromium from navigation start to the frame after the first `.group` appears. Done when the same measurement on OneTab 2.24 with the same 3,000 links is recorded next to it, and savetab's number is the lower one.
- If savetab is not faster, cut the read: the page loads every record with `db.items.toArray()` in `apps/extension/entrypoints/onetab/App.svelte` before it draws. Done when the measurement above beats OneTab and the five commands in `CLAUDE.md` pass.

## Pointers

- Open UI findings and the question about pairing approval: `docs/candidates.md`.

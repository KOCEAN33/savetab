# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

Continue P4 at step 5 of `docs/plans/onetab-parity.md` `### P4: sync server`: the sync client in the extension. It is first because the plan's steps run in order and the owner said to continue from here. Steps 1 to 4 are built. `apps/server` has every endpoint of the plan's "HTTP API" list. `packages/core` holds the op format, the merge rule, and the client crypto in `src/crypto.ts`. No code calls the server or the crypto yet.

State that shapes step 5:

- The server refuses to start without the OIDC variables in `apps/server/README.md`, and it reads the issuer's discovery document at start. The step's e2e runs against a local server, so it needs an issuer the test starts, as `apps/server/internal/api/auth_test.go` does, or another way to get device tokens.
- Server tests need the tailnet, see `apps/server/README.md`. A local server for the e2e needs a Postgres too.
- `packages/core/src/crypto.ts` is exempt from the lint rule that bans `crypto.subtle` in core. Its functions run outside `transact`.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- P4 steps 6 to 9 follow step 5 in the plan's order. Each is done when its check in the plan passes plus the five commands in `CLAUDE.md`.

## Pointers

- Deferred server work, the open UI findings, and the items waiting on the owner (the OIDC issuer, pairing approval): `docs/candidates.md`.

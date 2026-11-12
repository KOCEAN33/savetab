# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

The owner asked for tests right after the step 5 report named the missing Firefox sync e2e, and it is not started. A guess: the owner means that e2e, two Firefox profiles against `apps/server/scripts/e2e-server.sh` in `apps/extension/e2e-firefox/`. Confirm before building.

Then continue P4 at step 6 of `docs/plans/onetab-parity.md` `### P4: sync server`: the account UI. It is first because the plan's steps run in order. Steps 1 to 5 and step 9 are built: the server runs at `https://savetab.lab.hiriri.com` (`apps/server/README.md` "Deployment"), and two browser profiles sync through a local server in `apps/extension/e2e/sync.spec.ts`.

State that shapes step 6:

- No page joins an account yet. The e2e joins through the test hook `savetabTest.joinSync`, with tokens the test gets from the login endpoints and a data key it makes itself. `joinSync` in `apps/extension/lib/db.ts` is the function the UI calls once it holds the tokens and the data key.
- The extension has no `identity` permission and no code that calls `browser.identity.launchWebAuthFlow`, wraps a data key, or runs a pairing. `packages/core/src/crypto.ts` has the functions, and `apps/extension/lib/sync.ts` has the HTTP client for one account.
- The server has no endpoint that lists or revokes devices, and none that signs a device out. `store.RevokeDevice` exists. Step 6 lists and revokes devices, so it adds them to the plan's HTTP API first.
- The e2e server (`apps/server/README.md`) logs every visitor in without a page to click, and takes its allowed redirect URIs from `AUTH_REDIRECT_URIS`. The extension's is `browser.identity.getRedirectURL()`.
- A failed sync cycle is only logged in the background console. The UI needs a stored status to show, see `docs/candidates.md` "Sync server follow-ups".

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- P4 steps 7 and 8 follow step 6 in the plan's order. Each is done when its check in the plan passes plus the five commands in `CLAUDE.md`.

## Pointers

- Deferred server work, the open UI findings, and the items waiting on the owner (a public name for the server, pairing approval): `docs/candidates.md`.

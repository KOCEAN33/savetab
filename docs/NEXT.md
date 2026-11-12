# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

P4 step 7 of `docs/plans/onetab-parity.md` `### P4: sync server`: snapshots from the client. Steps 1 to 6 and step 9 are built: the server runs at `https://savetab.lab.hiriri.com` (`apps/server/README.md` "Deployment"). Done when its check in the plan passes plus the five commands in `CLAUDE.md`. The plan gives step 7 no check yet, so the step writes one first.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.

## Next steps

- P4 step 8 follows step 7 in the plan's order.
- The deployed server runs an image without `GET /v1/devices` and `DELETE /v1/devices/{id}`. The sync page needs them, so a deploy of the current `main` image comes before the first real sign-in (`apps/server/README.md` "Deployment").

State that shapes the next steps:

- The sync page is `apps/extension/entrypoints/account/`, linked from the options page. Its steps are in `apps/extension/lib/account.ts`: sign in through `browser.identity.launchWebAuthFlow`, first-device setup with a recovery key shown once, join by recovery key, join by a 6-digit pairing code, device list and removal, sign out.
- `client` in `apps/extension/lib/sync.ts` is the one way to call the server as a device. The background and an open page share a token refresh through the Web Lock `savetab-refresh`.
- Each cycle stores how it ended in `meta` (`syncStatus` in `apps/extension/lib/db.ts`), and the sync page shows it.
- No login has run against the deployed server and Zitadel. The e2e server logs every visitor in without a page to click.
- Unexplained, guess labeled: during one stretch of about 5 minutes, `e2e-firefox/sync.spec.ts` "a device that joins uploads the tabs it already holds" failed 5 runs in a row, and one database dump showed the joining profile with 0 items right after `joinSync`. Every run before and after passed on the same sources, 9 runs after. Guess: another session was editing or building in this working tree in that stretch. No cause is confirmed.

## Pointers

- Deferred server work, the open UI findings, and the items waiting on the owner (a public name for the server, pairing approval): `docs/candidates.md`.

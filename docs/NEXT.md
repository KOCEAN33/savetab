# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

P4 step 8 of `docs/plans/onetab-parity.md` `### P4: sync server`: share as a web page. It is first because steps 1 to 7 and step 9 are built. The plan gives step 8 two words and no check, and names only the `shares` table and "its own random key in the URL fragment", so the step first writes its design and its check into the plan, then builds. Done when the check passes plus the five commands in `CLAUDE.md`.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.
- The check of a step is e2e test code that `pnpm test:e2e` or `pnpm test:e2e:firefox` runs, never a browser driven by hand.

Question asked and not answered:

- `CLAUDE.md` has a line from another session: joining and leaving an account keep every stored record. Did the owner see records disappear on a join? This session saw it once in a test, see the last state line below.

## State

- The sync page is `apps/extension/entrypoints/account/`, linked from the options page. Its steps are in `apps/extension/lib/account.ts`.
- `client` in `apps/extension/lib/sync.ts` is the one way to call the server as a device. The background and an open page share a token refresh through the Web Lock `savetab-refresh`.
- `transact` (`apps/extension/lib/db.ts`) reads and writes through the transaction's own tables, since Dexie drops its transaction zone after about 100 awaits with no IndexedDB call. Code that runs after a long mutation inside an outer `db.transaction` must await the `transact` promise before it touches `db`.
- A device stores the `seq` of the last snapshot it uploaded or read in `meta` under `snapshotSeq`.
- Each cycle stores how it ended in `meta` (`syncStatus` in `apps/extension/lib/db.ts`), and the sync page shows it.
- The two-profile e2e fixtures, with the sync server, are `apps/extension/e2e/sync-fixtures.ts` and `apps/extension/e2e-firefox/sync-fixtures.ts`.
- The deployed server's image is older than `GET /v1/devices` and `DELETE /v1/devices/{id}`, which the sync page calls. A push to `main` builds the image, and the deploy is a commit in homelab-workloads (`apps/server/README.md` "Deployment"). No login has run against the deployed server and Zitadel.
- Unexplained: for about 5 minutes, `e2e-firefox/sync.spec.ts` "a device that joins uploads the tabs it already holds" failed 5 runs in a row, and one database dump showed the joining profile with 0 items right after `joinSync`. Every run before and after passed on the same sources, more than 10 after. Guess: another session edited or built in this working tree in that stretch. No cause is confirmed.

## Pointers

- Deferred server work, the sync page's open follow-ups, the open UI findings, and the items waiting on the owner (a public name for the server, pairing approval): `docs/candidates.md`.

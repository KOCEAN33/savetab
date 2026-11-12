# Next

## Goal

Put the built sync server (plan phase P4) to use: every step of `docs/plans/onetab-parity.md` `### P4: sync server` is built and passes its check, and the deployed server has not caught up.

## Start

Deploy the current server and run the first real login. It is first because the deployed image is older than `/v1/devices` and `/v1/shares`, which the sync page and "Share as a web page" call, and no login has run against the deployed server and Zitadel. A push to `main` builds the image, and the deploy is a commit in homelab-workloads (`apps/server/README.md` "Deployment"). The server applies migration `0004_shares.sql` at start. Done when the sync page of an installed extension signs in at `https://savetab.lab.hiriri.com`, a second device joins and shows the first one's tabs, and a shared group's URL opens on the tailnet. The login needs the owner at the browser.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.
- The `CLAUDE.md` rule that a join or leave keeps every stored record is a precaution. The owner has not seen records disappear.
- The check of a step is e2e test code that `pnpm test:e2e` or `pnpm test:e2e:firefox` runs, never a browser driven by hand.

## State

- The sync page is `apps/extension/entrypoints/account/`, linked from the options page. Its steps are in `apps/extension/lib/account.ts`.
- `client` in `apps/extension/lib/sync.ts` is the one way to call the server as a device. The background and an open page share a token refresh through the Web Lock `savetab-refresh`.
- `transact` (`apps/extension/lib/db.ts`) reads and writes through the transaction's own tables, since Dexie drops its transaction zone after about 100 awaits with no IndexedDB call. Code that runs after a long mutation inside an outer `db.transaction` must await the `transact` promise before it touches `db`.
- A device stores the `seq` of the last snapshot it uploaded or read in `meta` under `snapshotSeq`.
- Each cycle stores how it ended in `meta` (`syncStatus` in `apps/extension/lib/db.ts`), and the sync page shows it.
- The two-profile e2e fixtures, with the sync server, are `apps/extension/e2e/sync-fixtures.ts` and `apps/extension/e2e-firefox/sync-fixtures.ts`.
- Sharing is `apps/extension/lib/share.ts`, and the viewer page is `apps/server/internal/api/viewer/`. The list page passes the account's server URL to `ItemMenu`, which shows the share entries only with one.
- Unexplained: for about 5 minutes, `e2e-firefox/sync.spec.ts` "a device that joins uploads the tabs it already holds" failed 5 runs in a row, and one database dump showed the joining profile with 0 items right after `joinSync`. Every run before and after passed on the same sources, more than 10 after. Guess: another session edited or built in this working tree in that stretch. No cause is confirmed.

## Pointers

- Deferred server work, the sync page's open follow-ups, the open UI findings, and the items waiting on the owner (a public name for the server, pairing approval): `docs/candidates.md`.

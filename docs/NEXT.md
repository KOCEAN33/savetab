# Next

## Goal

Build the self-hosted sync server (plan phase P4), so the stored tab list syncs across the owner's devices with end-to-end encryption.

## Start

P4 step 7 of `docs/plans/onetab-parity.md` `### P4: sync server`: snapshots from the client. It is first because steps 1 to 6 and step 9 are built and the plan orders 7 before 8. The plan gives step 7 one sentence and no check, so the step first writes its check into the plan, then builds. It covers both directions: a device uploads a snapshot through `PUT /v1/snapshot` once the log passes 5,000 ops since the last one, and a device whose pull answers 409 `snapshot_required` reads `GET /v1/snapshot` and pulls from its `seq`. Today that 409 fails every cycle (`apps/extension/lib/sync.ts` `pull`). Done when the check passes plus the five commands in `CLAUDE.md`.

Orders from the owner that bind P4:

- Ops are end-to-end encrypted. The recovery key is shown once, and the data cannot be recovered without it.
- A new device joins by the recovery key or by pairing with a signed-in device. Pairing by a hand-started 6-digit code comes first. Pairing that starts by itself after login comes later.
- The check of a step is e2e test code that `pnpm test:e2e` or `pnpm test:e2e:firefox` runs, never a browser driven by hand.

Question asked and not answered:

- `CLAUDE.md` has an uncommitted line from another session: joining and leaving an account keep every stored record. Did the owner see records disappear on a join? This session saw it once in a test, see the last state line below.

## Next steps

- P4 step 8 follows step 7 in the plan's order. The plan gives it no check yet, so it writes one first. Done when that check passes plus the five commands in `CLAUDE.md`.
- Commit this session's edit to `docs/candidates.md` "Sync server follow-ups": two lines removed, five added. It is uncommitted because the same file holds another session's uncommitted section "User requests not yet built", and `CLAUDE.md` holds that session's line. Done when `git status --short` shows neither file.

State that shapes the next steps:

- The sync page is `apps/extension/entrypoints/account/`, linked from the options page. Its steps are in `apps/extension/lib/account.ts`.
- `client` in `apps/extension/lib/sync.ts` is the one way to call the server as a device. The background and an open page share a token refresh through the Web Lock `savetab-refresh`.
- Each cycle stores how it ended in `meta` (`syncStatus` in `apps/extension/lib/db.ts`), and the sync page shows it.
- The two-profile e2e fixtures, with the sync server, are `apps/extension/e2e/sync-fixtures.ts` and `apps/extension/e2e-firefox/sync-fixtures.ts`.
- The deployed server's image is older than `GET /v1/devices` and `DELETE /v1/devices/{id}`, which the sync page calls. A push to `main` builds the image, and the deploy is a commit in homelab-workloads (`apps/server/README.md` "Deployment"). No login has run against the deployed server and Zitadel.
- Unexplained: for about 5 minutes, `e2e-firefox/sync.spec.ts` "a device that joins uploads the tabs it already holds" failed 5 runs in a row, and one database dump showed the joining profile with 0 items right after `joinSync`. Every run before and after passed on the same sources, more than 10 after. Guess: another session edited or built in this working tree in that stretch. No cause is confirmed.

## Pointers

- Deferred server work, the sync page's open follow-ups, the open UI findings, and the items waiting on the owner (a public name for the server, pairing approval): `docs/candidates.md`.

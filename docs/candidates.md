# Candidates

Deferred work, not scheduled.

## OneTab behaviors seen in the real extension but not built

- The first restore shows a modal asking "After restoring tabs: remove from list / keep in list", with remove preselected. Nothing restores until the user saves a choice.
- The first group delete shows a tip: hover the group title and click X to move it to trash.
- Install opens the OneTab help page in a tab.
- Export strips the trailing slash when the URL path is only `/`.
- Notes have an emoji picker shortcut. features.md does not say what the shortcut does or opens.
- Group date line format is `M/D/YY h:mm AM/PM - <relative time>`, such as `11/9/26 8:09 PM - just now`. savetab shows the month and day, with the full date and time in a tooltip.

## User requests not yet built

The user asked for these on 2026-11-12, to be done later.

- An option to leave extension pages (`chrome-extension://`, `moz-extension://`, and similar) out of a send. Today only savetab's own pages and the empty pages in `BLANK_PAGES` (`apps/extension/lib/capture.ts`) are skipped.

## UI review findings left open

- The options page is one long form of radio groups. Short choices could be selects on one row, with a section nav.
- The options, import, and send pages have their own header, not the list page's top bar.
- The send page opens on a filter label, with no heading and no empty state when 0 tabs qualify.
- On a 390px screen the item menu covers its own group. The top bar's icon buttons have tooltips only.
- The list page reads every record before it draws (`db.items.toArray()` in `entrypoints/onetab/App.svelte`). With 3,000 stored tabs in 150 groups its first group paints at a median of 107 ms after navigation, against 564 ms for OneTab 2.24 with the same links (`apps/extension/scripts/first-open.mjs`, Playwright Chromium, 15 opens each, slowest savetab open 116 ms, fastest OneTab open 159 ms). A per-folder query would cut the read further.
- On a 390px screen the selection bar wraps its 7 actions into 4 lines and covers the last rows. Every action, "Move to trash" included, is the same blue link.
- At the 960px list width a short title sits far from its domain at the row's right end. A screenshot review asked for the domain right after the title.
- Group heads use role `treeitem` for keyboard focus, but no element around them has role `tree`.
- Folders cannot be reordered by drag. A folder chip shows in the order its `order` key gives, and "Sort groups" does not sort folders.
- A folder has no tick, so a bulk move of several folders goes one folder at a time through the folder's menu.
- `mergeGroups` in core has no UI caller. OneTab merges a group dropped on another group.
- Importing 12,000 lines on the import page did not finish within 2 minutes.

## Open choices and code follow-ups

- features.md lists two `P1` items that are not built: export from a chosen location (the import-export page exports the whole root) and an import destination (import always lands at the root).
- Under a full `pnpm test:e2e:firefox` run, `e2e-firefox/pages.spec.ts` fails about one run in five: the import test once with `StaleElementReferenceError` on the import textarea, the list-page test once with "No links found". Each passes alone. No cause is confirmed.
- The Firefox GUI check has not covered P2 multi-select, sort, collapse, paging, or keyboard navigation. Chromium e2e covers them.

- Dragging tabs into a group does not update the recent destination list. Only sends and moves through the location dialog do (plan P2 step 10). Counting drags needs `GroupView` to tell a drop from another group apart from a reorder.
- The default group label `tn('tabCount', n)` is computed separately in `GroupView.svelte`, `LocationDialog.svelte`, `TrashView.svelte`, `lib/menus.ts`, and `entrypoints/send/App.svelte`. One shared helper would replace them.
- Errors thrown by `@savetab/core`, such as a locked group refusing a change, reach `alert` in English. Core has no locale, so a translation needs error codes mapped to locale keys.
- Restoring a single tab ignores `discardOnOpen`. Only group and selection restores discard.
- "Import reading list" shows in every Chrome build, since `browser.readingList` is undefined until the optional permission is granted. No e2e or GUI run has imported a real reading list.
- A group's sticky `restoreTarget`, such as incognito, is not shown on the group, so "Restore all" opening a private window can surprise the user. Showing it on the meta line would make it visible.
- The rich text paste unit test covers anchor filtering only. `DOMParser` parsing is covered by the e2e paste, since vitest runs without a DOM.

## Sync server follow-ups

- A refresh token used twice answers 401 and nothing else. Revoking the device on a reused token would cut off a thief who refreshed first.
- `GET /v1/auth/start` stores one `logins` row per request without a bearer token or a rate limit. Rows expire after 10 minutes and the next start deletes them.
- The server logs in through one issuer and gives an account to anyone that issuer logs in. `identities` is keyed by `(issuer, subject)`, so a second issuer or an allow list can join.

- The outbox of a device with no account keeps every op since install and is never trimmed. Joining replaces it, so it could stay empty until the device joins.
- A share lives 30 days, fixed. A choice of the expiry at share time has no UI.
- A shared page is a copy. Showing later edits means "Stop sharing" and a new share, which changes the URL.
- A share uploaded just before its `setShare` write fails stays on the server until it expires, with no record that names it.
- The viewer page's text is English only.
- The Firefox e2e of sharing builds the URL from the record. Only the Chromium e2e reads the clipboard.
- Each device counts the 5,000 ops from the last snapshot it uploaded or read itself, so two devices that pull the same log both upload one. A pull answer that carried the snapshot's `seq` would let the second skip it.
- A snapshot holds the uploader's records with no receive time. A field the uploader wrote while its clock ran more than `MAX_SKEW_MS` ahead reaches a device that reads the snapshot, though every device skips that op in a pull.
- A snapshot is sealed and sent as one JSON body, base64 built in memory (`uploadSnapshot` in `apps/extension/lib/sync.ts`). No test measures it with a large list.
- A device that logs in on the sync page and leaves before it holds the key stays in the account's device list. The login lives in the page's memory, so a reload starts over and the next login makes another device.
- The sync page's first-device setup, recovery key join, pairing, device removal, and sign out have e2e in Chromium (`e2e/account.spec.ts`). Firefox e2e covers first-device setup and the recovery key join. `apps/extension/lib/account.ts` has no unit test.
- A pairing that expires or fails its commitment check has no test.
- The sync page shows the recovery key and the pairing code at the 18px headline size, the largest step `DESIGN.md` has. A screenshot review asked for a larger code, a step heading per state, and a progress cue while a new device waits to pair.
- A background worker stopped between a refresh answer and the write of the new tokens leaves the device with a spent refresh token, so it must log in again.

- The deployed server's Firefox redirect URI is computed as the SHA-1 of the add-on id. No login has checked it against `browser.identity.getRedirectURL()` in a real Firefox.
- A new server image is deployed by hand: a commit in homelab-workloads sets the tag. saveweb's image workflow bumps the tag itself through the `kocean33-homelab-ci` GitHub App.
- No login has run end to end against the deployed server and Zitadel. The check so far is the 302 from `/v1/auth/start` to the issuer.

## Code review findings

Structure:

- `db` is exported from `lib/db.ts:38` and read in 10 files. Exporting read functions instead lets `no-restricted-imports` ban table access outside `lib/db.ts`. `scripts/lint-conventions.mjs` catches direct table writes until then.
- Tabs imported before import normalized URLs keep their raw `url`. Emptying trash can still purge a link such a tab shares, since `byUrl` looks up the normalized form. A one-time pass that rewrites stored tab URLs through a core mutation would close it.
- `sortGroups` reissues keys over live siblings only, so a trashed sibling can share a key with a live one. `orderKeys` re-keys the tie when something is inserted there.
- `mutations.ts` holds capture policy, tree edits, and trash. Its `max-lines` limit in `.oxlintrc.json` is 600 until it splits into `capture.ts`, `tree.ts`, `trash.ts`.
- A backup taken before database version 3 holds the excluded hosts as one `excludedDomains` array. `restoreSnapshot` drops that field, so a restore from such a backup loses the excluded hosts. The weekly backup replaces it within 7 days.

Lint rules not turned on:

- Type-aware oxlint rules such as `typescript/no-floating-promises` need the `oxlint-tsgolint` dependency.
- oxlint reads a `.svelte` file's script block only. Rules on template code, such as raw UI text outside `t` or an `e.currentTarget` read inside `act`, need eslint with `eslint-plugin-svelte`.

## Waiting on the user

- Review the Korean strings in `apps/extension/locales/ko.json` and `public/_locales/ko/messages.json`. Wording and terms are the user's call.
- P4 (sync server): whether the server gets a public name. It is tailnet-only, so a device syncs only on the tailnet, and a shared page opens only there. `GET /v1/auth/start` has no rate limit, which matters once it is public.
- P4 (sync server): in the later build where pairing starts by itself after login, what the signed-in device shows for approval. A one-tap approve trusts the server to relay the right key. Comparing the pairing code does not.

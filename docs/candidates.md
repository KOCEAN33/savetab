# Candidates

Deferred work, not scheduled.

## OneTab behaviors seen in the real extension but not built

- The first restore shows a modal asking "After restoring tabs: remove from list / keep in list", with remove preselected. Nothing restores until the user saves a choice.
- The first group delete shows a tip: hover the group title and click X to move it to trash.
- Install opens the OneTab help page in a tab.
- Export strips the trailing slash when the URL path is only `/`.
- Notes have an emoji picker shortcut. features.md does not say what the shortcut does or opens.
- Group date line format is `M/D/YY h:mm AM/PM - <relative time>`, such as `11/9/26 8:09 PM - just now`. savetab shows the month and day, with the full date and time in a tooltip.

## UI review findings left open

- The options page is one long form of radio groups.
- Group heads use role `treeitem` for keyboard focus, but no element around them has role `tree`.
- Folders cannot be reordered by drag. A folder chip shows in the order its `order` key gives, and "Sort groups" does not sort folders.
- A folder has no tick, so a bulk move of several folders goes one folder at a time through the folder's menu.
- `mergeGroups` in core has no UI caller. OneTab merges a group dropped on another group.
- Importing 12,000 lines on the import page did not finish within 2 minutes.

## Open choices and code follow-ups

- features.md lists two `P1` items that are not built: export from a chosen location (the import-export page exports the whole root) and an import destination (import always lands at the root).
- The Firefox GUI check has not covered P2 multi-select, sort, collapse, paging, or keyboard navigation. Chromium e2e covers them.

- Dragging tabs into a group does not update the recent destination list. Only sends and moves through the location dialog do (plan P2 step 10). Counting drags needs `GroupView` to tell a drop from another group apart from a reorder.
- The default group label `tn('tabCount', n)` is computed separately in `GroupView.svelte`, `LocationDialog.svelte`, `TrashView.svelte`, `lib/menus.ts`, and `entrypoints/send/App.svelte`. One shared helper would replace them.
- Errors thrown by `@savetab/core`, such as a locked group refusing a change, reach `alert` in English. Core has no locale, so a translation needs error codes mapped to locale keys.
- Restoring a single tab ignores `discardOnOpen`. Only group and selection restores discard.
- "Import reading list" shows in every Chrome build, since `browser.readingList` is undefined until the optional permission is granted. No e2e or GUI run has imported a real reading list.
- A group's sticky `restoreTarget`, such as incognito, is not shown on the group, so "Restore all" opening a private window can surprise the user. Showing it on the meta line would make it visible.
- The rich text paste unit test covers anchor filtering only. `DOMParser` parsing is covered by the e2e paste, since vitest runs without a DOM.

## Code review findings

Before P4 pushes its first op:

- `applyOp` (`packages/core/src/merge.ts:6`) applies any field, so an op can overwrite `id` or `clocks`. Core needs a per-kind allowlist of syncable fields, shared with `updateItem`, plus a format version and device id on `Op`.
- `excludedDomains` is one last-writer-wins array (`lib/settings.ts:43`, `lib/capture.ts:145`), so two devices that each add a domain offline keep only one addition.
- A live item under a purged parent is invisible after a merge. Core needs one re-home rule, used by `restoreFromTrash` and by remote apply.
- `restoreSnapshot` (`mutations.ts:582`) stamps fresh clocks, so a backup restore on a synced device overrides newer edits from other devices.
- The plan puts the server in Go, while its invariant says server tests reuse `core`. Without end-to-end encryption the server reimplements `applyOp`, `tick`, and `observe`, so core's sync tests should export JSON vectors for it.
- `normalizeUrl` is `new URL(raw).href`, which differs by engine for non-special schemes: Chromium gives `chrome://crash/`, Node gives `chrome://crash`. `linkId` hashes that form, so two engines can derive different link ids for one URL.
- `observe` (`packages/core/src/hlc.ts:19`) accepts any remote clock. A device whose clock runs ahead wins every field until a max-skew check exists.

Structure:

- `db` is exported from `lib/db.ts:38` and read in 10 files. Exporting read functions instead lets `no-restricted-imports` ban table access outside `lib/db.ts`. `scripts/lint-conventions.mjs` catches direct table writes until then.
- `lib/settings.ts:45` calls `tx.write` directly, and `updateItem` (`mutations.ts:228`) takes `Record<string, unknown>`, so a UI patch can set `kind`, `parentId`, or `order` past the lock checks.
- Tabs imported before import normalized URLs keep their raw `url`. Emptying trash can still purge a link such a tab shares, since `byUrl` looks up the normalized form. A one-time pass that rewrites stored tab URLs through a core mutation would close it.
- `sortGroups` reissues keys over live siblings only, so a trashed sibling can share a key with a live one. `orderKeys` re-keys the tie when something is inserted there.
- `mutations.ts` holds capture policy, tree edits, trash, sort, and snapshot. Its `max-lines` limit in `.oxlintrc.json` is 600 until it splits into `order.ts`, `capture.ts`, `tree.ts`, `trash.ts`.

Lint rules not turned on:

- Type-aware oxlint rules such as `typescript/no-floating-promises` need the `oxlint-tsgolint` dependency.
- oxlint reads a `.svelte` file's script block only. Rules on template code, such as raw UI text outside `t` or an `e.currentTarget` read inside `act`, need eslint with `eslint-plugin-svelte`.

## Waiting on the user

- Review the Korean strings in `apps/extension/locales/ko.json` and `public/_locales/ko/messages.json`. Wording and terms are the user's call.
- P4 (sync server) starts with the open decision in `docs/plans/onetab-parity.md` P4: whether ops are end-to-end encrypted.

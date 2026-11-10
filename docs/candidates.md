# Candidates

Deferred work, not scheduled.

## OneTab behaviors seen in the real extension but not built

- The first restore shows a modal asking "After restoring tabs: remove from list / keep in list", with remove preselected. Nothing restores until the user saves a choice.
- The first group delete shows a tip: hover the group title and click X to move it to trash.
- Install opens the OneTab help page in a tab.
- Export strips the trailing slash when the URL path is only `/`.
- Notes have an emoji picker shortcut. features.md does not say what the shortcut does or opens.
- Group date line format is `M/D/YY h:mm AM/PM - <relative time>`, such as `11/9/26 8:09 PM - just now`. savetab shows `Created <locale date and time>`.

## UI review findings left open

From the screenshot review of the P1 pages. The list keeps OneTab's plain look on purpose (`DESIGN.md`), so card layouts and centered columns were not adopted.

- Mobile-width touch targets are text links about 14px tall.
- The options page is one long form of radio groups.
- The group drag handle `⠿` is small and low contrast.
- Folder and group heads use role `treeitem` for keyboard focus, but no element around them has role `tree`.

## Open choices and code follow-ups

- features.md lists two `P1` items that are not built: export from a chosen location (the import-export page exports the whole root) and an import destination (import always lands at the root).
- Archived rows show `--color-on-surface-weak` text on a `--color-border` background (`styles/base.css`): 3.91:1 in the light palette and 3.96:1 in the dark one, below 4.5:1.
- The Firefox GUI check has not covered P2 multi-select, sort, collapse, paging, or keyboard navigation. Chromium e2e covers them.

- Dragging tabs into a group does not update the recent destination list. Only sends and moves through the location dialog do (plan P2 step 10). Counting drags needs `GroupView` to tell a drop from another group apart from a reorder.
- The default group label `tn('tabCount', n)` is computed separately in `NavColumn.svelte`, `TasksView.svelte`, `GroupView.svelte`, `LocationDialog.svelte`, `TrashView.svelte`, `lib/menus.ts`, and `entrypoints/send/App.svelte`. One shared helper would replace them.
- Errors thrown by `@savetab/core`, such as a locked group refusing a change, reach `alert` in English. Core has no locale, so a translation needs error codes mapped to locale keys.
- Restoring a single tab ignores `discardOnOpen`. Only group and selection restores discard.
- "Import reading list" shows in every Chrome build, since `browser.readingList` is undefined until the optional permission is granted. No e2e or GUI run has imported a real reading list.
- A group's sticky `restoreTarget`, such as incognito, is not shown on the group, so "Restore all" opening a private window can surprise the user. Showing it on the meta line would make it visible.
- The rich text paste unit test covers anchor filtering only. `DOMParser` parsing is covered by the e2e paste, since vitest runs without a DOM.

## Code review findings

Each defect has a repro in the review run. None is fixed.

Defects:

- Emptying trash can purge a link a live tab still uses, which clears that tab's title and notes. `insertTabs` (`packages/core/src/mutations.ts:165`) stores an imported URL without `normalizeUrl`, while `emptyTrash` (`:343`) looks up live copies by the raw URL and purges by the normalized link id. The same raw URL also slips past `duplicates: 'reject'`. Fix: normalize in `insertTabs`, look up `byUrl(normalizeUrl(url))` in `emptyTrash`, and normalize stored URLs once.
- Restoring an item whose ancestor is in trash leaves it unreachable from the root and absent from the trash list, and the next "empty trash" purges it. `restoreFromTrash` (`mutations.ts:317`) handles only a tab's direct parent. Fix: walk the ancestor chain, restore trashed ancestors, and move the item to the root when an ancestor is purged.
- Two siblings with the same order key make a move or copy between them throw ` >= `. `sortGroups` skips trashed siblings and reissues their keys, so restoring one creates the tie. The neighbour-key logic is copied at `mutations.ts:97`, `:111`, `:166`, `:248`, `:386`, `:518`, `:572`. Fix: one helper that sorts by (order, id) and re-keys a tied run in the same transaction.
- "Move to" lands at the bottom when the destination's first shown child is pinned. `LocationDialog.svelte:62` and `NavColumn.svelte:50` pass the first displayed child as `beforeId`. Fix: an at-top mode in `moveItems` and `copyItems`.

Before P4 pushes its first op:

- Order-key ties, above: two devices that each insert at the top produce one on every merge.
- `applyOp` (`packages/core/src/merge.ts:6`) applies any field, so an op can overwrite `id` or `clocks`. Core needs a per-kind allowlist of syncable fields, shared with `updateItem`, plus a format version and device id on `Op`.
- `excludedDomains` is one last-writer-wins array (`lib/settings.ts:43`, `lib/capture.ts:145`), so two devices that each add a domain offline keep only one addition.
- A live item under a purged parent is invisible after a merge. Core needs one re-home rule, used by `restoreFromTrash` and by remote apply.
- `restoreSnapshot` (`mutations.ts:582`) stamps fresh clocks, so a backup restore on a synced device overrides newer edits from other devices.
- The plan puts the server in Go, while its invariant says server tests reuse `core`. Without end-to-end encryption the server reimplements `applyOp`, `tick`, and `observe`, so core's sync tests should export JSON vectors for it.
- `observe` (`packages/core/src/hlc.ts:19`) accepts any remote clock. A device whose clock runs ahead wins every field until a max-skew check exists.

Structure:

- `db` is exported from `lib/db.ts:38` and read in 10 files. Exporting read functions instead lets `no-restricted-imports` ban table access outside `lib/db.ts`. `scripts/lint-conventions.mjs` catches direct table writes until then.
- `lib/settings.ts:45` calls `tx.write` directly, and `updateItem` (`mutations.ts:228`) takes `Record<string, unknown>`, so a UI patch can set `kind`, `parentId`, or `order` past the lock checks.
- `mutations.ts` holds capture policy, tree edits, trash, quick list, sort, and snapshot. Its `max-lines` limit in `.oxlintrc.json` is 600 until it splits into `order.ts`, `capture.ts`, `tree.ts`, `trash.ts`.

Lint rules not turned on:

- Type-aware oxlint rules such as `typescript/no-floating-promises` need the `oxlint-tsgolint` dependency.
- oxlint reads a `.svelte` file's script block only. Rules on template code, such as raw UI text outside `t` or an `e.currentTarget` read inside `act`, need eslint with `eslint-plugin-svelte`.

## Waiting on the user

- Review the Korean strings in `apps/extension/locales/ko.json` and `public/_locales/ko/messages.json`. Wording and terms are the user's call.
- P4 (sync server) starts with the open decision in `docs/plans/onetab-parity.md` P4: whether ops are end-to-end encrypted.

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

## Waiting on the user

- Review the Korean strings in `apps/extension/locales/ko.json` and `public/_locales/ko/messages.json`. Wording and terms are the user's call.
- P4 (sync server) starts with the open decision in `docs/plans/onetab-parity.md` P4: whether ops are end-to-end encrypted.

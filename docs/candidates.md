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

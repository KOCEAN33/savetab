# OneTab feature inventory

savetab targets feature parity with OneTab 2.24 (Chrome Web Store id `chphlpgkkbolifaimnlloiipkdnihall`), then adds self-hosted multi-device sync. Sources: the extension's `manifest.json` and `_locales/en/messages.json`, https://www.one-tab.com/help, and a run of the real extension in a throwaway Chromium profile. A line marked *(inferred)* is a reading of UI strings, not observed behavior. Verify it in the real extension before building it.

Phase tags (`P1`-`P5`) refer to `docs/plans/onetab-parity.md`.

## Data hierarchy

- Folders contain folders and groups. Groups contain tabs. A tab lives in exactly one group. `P1` stores folders, `P2` shows them.
- Root list sorts pinned items first, then the rest in manual order. `P1`
- Copies of the same URL share one title and one notes field across the whole list. `P2`
- Trash holds deleted items until "Delete all trash". `P1`
- Quick list: a separate column of references to tabs or groups. Removing an item from it does not trash the item. `P2`

## Item flags

| Flag | Applies to | Effect | Phase |
| --- | --- | --- | --- |
| Title | group, folder, tab | Group default label is "{N} tabs". Click on title edits it or restores, per option. | P1 |
| Notes | group, folder, tab | Free text with a character limit. Emoji picker shortcut. | P2 |
| Lock | group | Group and its tabs cannot be deleted or reordered. Restoring keeps tabs. | P1 |
| Star | group, tab | Visual importance marker. | P1 |
| Pin to top | group, folder | Listed at the top of its folder. | P1 |
| Task | group, tab | Pending or done. Tasks also appear in a Tasks view. | P2 |
| Archived | group, tab | Gray striped background. A filter hides archived items. | P2 |
| Pin tab when opened | tab | Restores as a pinned browser tab. | P3 |
| Open as browser tab group | group | Color, collapsed state, current or new window. | P3 |
| Remembered restore target | group | A restore choice made from the group's More menu sticks to that group. | P3 |
| Shared | group, folder | Shared web page with an expiry date. | P4 |

## Storing tabs

Toolbar icon, per option `P1` (popup mode `P3`):
- Send tabs in the current window. If several tabs are highlighted in the tab bar, send only those.
- Send the current window, including all tabs and browser tab groups.
- Send only the current tab. It goes into the first group that is not pinned or locked.
- Show the action popup.

Context menu inside a web page, under a OneTab submenu `P1`:
Open OneTab, Send only this tab, Send all tabs except this tab, Send tabs on the left, Send tabs on the right, Send all tabs in this window, Send all tabs from all windows, Send all tabs in this tab group, Send selected tabs, Send this web link (on a link), Exclude this web site from OneTab (a checkbox labeled with the current host). The menu can be disabled in options. Send to a named group or recent destination is `P2`.

A single tab or link sent by itself joins the first root group that is neither pinned nor locked, at the top of that group *(inferred position)*, like the toolbar's "send only the current tab" option.

Keyboard commands `P1`: `display-onetab` (default Alt+Shift+1), `send-current-tab-to-onetab`, `send-all-tabs-in-current-window-to-onetab`, `send-all-tabs-in-current-tab-group-to-onetab`, `send-all-tabs-except-this-to-onetab`, `send-left-tabs-to-onetab`, `send-right-tabs-to-onetab`, `send-all-tabs-in-all-windows-to-onetab`, plus the action shortcut.

Store rules `P1`:
- Pinned tabs are skipped unless the option allows them. "Send only this tab" still sends a pinned tab.
- Tabs from excluded domains are skipped. "Send only this tab" ignores the exclusion.
- The OneTab page itself is never stored.
- Duplicates: allow, or silently reject a URL already in the list.
- On a duplicate, keep the existing title or take the latest one.
- Empty pages (`about:blank`, new tab pages) close with the rest but are not stored.
- Each store creates a new group with its creation time, at the top of the list.

Action popup `P3`: lists open tabs with checkboxes. Filters: include pinned, include grouped, include already stored, include per-domain. Destination chooser with search and recent destinations. Group title field. "Merge open tabs here", "Close tabs already stored in OneTab", "Close these duplicates". `/` focuses the destination search.

## Restoring tabs

- Click a tab: open it. Option: switch to it, or stay in OneTab. Cmd/Ctrl-click inverts the switch. Shift-click opens in a new window. `P1`
- After restore, per option: remove from list, keep in list, or mark archived. Ctrl/Cmd keeps, Alt/Option archives. Locked groups always keep. `P1` (archive `P2`)
- Restore all: open the group's tabs. Option: current window, new window unless OneTab is the only tab, or always a new window. `P1`
- More menu: Restore in this window, Restore in a new window, Restore in a new incognito window. `P3`
- Restore all never asks for confirmation. Restoring more than 50 selected tabs asks "You are about to open {N} tabs", and one open is capped at 500 tabs. `P2`
- Option: discard non-active tabs on first open to save memory. `P3`
- URLs the browser refuses to open from an extension (`chrome://`, `about:`, `file:`) open a placeholder page with copy instructions. `P3`

## OneTab page

- Header: total tab count, search, Options, Import & Export, Help, theme switch, sync status. `P1` (search `P2`)
- Group row: title or "{N} tabs", "Created {date}", Restore all, Delete all, More menu, collapse/expand. `P1`
- Tab row: favicon, title link, URL display (full, abbreviated, domain only, none), delete button. `P1`
- Drag and drop: reorder tabs, groups, and folders. Drop tabs in blank space to make a new group. Drop a group on a group to merge. Ctrl or Alt while dragging copies. Drop text with links from another page to import them. `P1` reorder/move, `P2` merge/copy, `P3` text drop.
- Multi-select by tick icons. Right-click a tick for: Select all, Deselect all, Invert selection, Select all except this, Select this and above, Select this and below. Bulk actions on the selection. `P2`
- Folder navigation column with recent folders and groups, filter (show everything, folders only, named only). `P2`
- Sort groups in a folder: A-Z, recently created, recently modified, recently accessed, reverse. Tabs inside are not sorted. `P2`
- Keyboard navigation: Tab to start, arrows to move, Enter to restore or open, Backspace for parent folder, Esc to end, fold toggle. `/` focuses search, folder-scoped variant. `P2`
- Paging with "Next {N}" and "Previous {N}" for long lists. `P2`
- Tasks view with pending and done counts. `P2`
- Light, dark, or automatic theme. `P3`

Group and folder More menu: Rename / Add note `P1`/`P2`, Lock / Unlock `P1`, Star / Remove star `P1`, Pin to top `P1`, Make this a task `P2`, Mark as archived `P2`, Move, Copy (location chooser) `P2`, Create group or folder above, within, below `P2`, Merge into parent, Merge with inner groups `P2`, Remove duplicates (within here, here that exist elsewhere, elsewhere that exist here) `P2`, Copy links to clipboard `P2`, Save as HTML file `P3`, Share as a web page `P4`, Open as browser tab group `P3`, Move to trash `P1`.

## Search

- Search box with match count. Filters: case sensitive, whole words, created on or after, created on or before, starred, tasks, has notes, named only, archived or non-archived, restrict to a folder. `P2`
- Omnibox keyword `11`: type `11`, space, then terms to search the list from the address bar. `P2`

## Import and export

- Export: plain text, one tab per line as `URL | Title`. Export from a chosen location. `P1`
- Import: paste plain text in the same format, title optional, protocol required. Choose a destination. `P1`
- Paste rich text from a web page or document, links are extracted. `P3`
- Import browser bookmarks (folder and sub-folders) and reading list, behind optional permissions. `P3`
- Copy to clipboard format: `URL | Title`, `Title URL`, URL only, Markdown, rich text where available. `P2`
- Save a folder as a downloadable HTML file. `P3`

Export puts one blank line between groups, newest group first, and omits group names.

## Options

The default is the first value in each row, as observed on a fresh OneTab 2.24 install.

| Option | Values | Phase |
| --- | --- | --- |
| Toolbar icon click | send window tabs / send whole window / send current tab / show popup | P1 (popup P3) |
| Pinned tabs | don't send / allow | P1 |
| At browser startup | open OneTab / don't | P1 |
| When restoring tabs | remove (to trash) / keep / archive | P1 |
| Restoring a group | new window unless OneTab alone / always new window / current window | P1 |
| Restore click | stay in OneTab / switch to tab | P1 |
| Duplicates | allow / silently reject | P1 |
| Title of a re-stored tab | keep existing / use latest | P1 |
| Open OneTab action | switch to its window / move OneTab tab to current window | P1 |
| Group title click | edit title / restore group or open folder | P1 |
| URL display | none / domain only / abbreviated / full | P1 |
| Context menu | enabled / disabled | P1 |
| Excluded web sites | exact host names, case-insensitive, empty by default | P1 |
| Copy to clipboard format | rich text / URL and title / title and URL / URL only / Markdown | P2 |
| Browser tab group restore | current window / new window | P3 |
| Discard tabs on open | off / on | P3 |
| Theme | automatic / light / dark, switched from the page header | P3 |
| Language | browser locale, ko and en first | P3 |

savetab adds "after storing tabs: show the list / stay" as an option. OneTab has it only in its popup flow.

## Robustness

- Weekly local backup in a separate storage area, restored on detected data loss. `P3`
- Incognito tabs are stored when the user allows the extension in incognito. `P3`

## Out of scope

- OneTab's license-key, billing, and recovery-email flows. savetab's own account and sync design replaces them in `P4`.

# Plan: OneTab parity, then self-hosted sync

Goal: a Chrome and Firefox extension with OneTab 2.24's features (`docs/specs/features.md`), whose saved tabs sync across a user's devices through a multi-user server backed by Postgres. Safari and mobile clients follow.

## Invariants

- The local store is the source of truth on each device. The extension works fully offline and without an account.
- Every item has a client-generated UUIDv7 id. No id comes from the server.
- Every local write goes through `core` mutations, which also append to the outbox. UI code never writes to IndexedDB directly.
- Order is a fractional index string, so two devices that reorder concurrently both converge.
- Deleting moves an item to trash. Emptying trash leaves a tombstone, so a delete propagates to other devices.
- `core` has no browser API imports. The extension, the server tests, and future clients all reuse it.

## Data model

```ts
type Id = string;      // UUIDv7
type Hlc = string;     // hybrid logical clock, "<ms>-<counter>-<deviceId>", sorts lexically

interface ItemBase {
  id: Id;
  parentId: Id | null;            // null = root folder
  order: string;                  // fractional index within parent
  createdAt: number;
  modifiedAt: number;
  accessedAt: number | null;
  trashedAt: number | null;       // non-null = in trash
  purged: boolean;                // tombstone after trash is emptied
  title: string;                  // "" = default label
  notes: string;
  star: boolean;
  task: 'none' | 'pending' | 'done';
  archived: boolean;
  collapsed: boolean;
  quickOrder: string | null;      // fractional index in the quick list, null = not listed
  clocks: Record<string, Hlc>;    // last-writer-wins clock per field
}

interface Link {                  // title and notes shared by every tab with this URL
  id: string;                     // "link-" + hash of url, the same on every device
  kind: 'link';
  url: string;                    // normalized
  title: string;
  notes: string;
  purged: boolean;
}

interface Folder extends ItemBase { kind: 'folder'; pinnedTop: boolean }

interface Group extends ItemBase {
  kind: 'group';
  pinnedTop: boolean;
  locked: boolean;
  openAs: { mode: 'window' | 'tabGroup'; color?: string; collapsed?: boolean };
  restoreTarget: 'default' | 'current' | 'new' | 'incognito';
}

interface Tab extends ItemBase { kind: 'tab'; url: string; favIconUrl: string; pinOnOpen: boolean }

interface Op {                    // outbox entry, one per item write
  opId: Id; itemId: Id; hlc: Hlc;
  fields: Record<string, unknown>;  // each field merges on its own clock
}
```

Settings split in two. Synced settings (exclusions, duplicate rule, restore rules, display rules) are the record with id `settings` in the item store, so they merge like an item. Device settings (toolbar action, startup, context menu, theme) stay in `browser.storage.local`.

A tab's title and notes live on a `Link` record shared by every copy of its URL (features.md "Data hierarchy"). See P2 step 1.

Merge rule for incoming ops: a field takes the op's value when the op's HLC is greater than the field's clock. Clients run this rule. Whether the server also runs it depends on the E2E decision in `P4`.

## Stack

- pnpm workspace. `packages/core` (TypeScript, data model, mutations, merge, import and export parsing). `apps/extension` (WXT, Svelte 5, TypeScript).
- WXT builds MV3 for Chrome and Firefox from one source, and has a Safari build path for `P5`.
- IndexedDB through Dexie. `liveQuery` pushes changes to every open OneTab page.
- Drag and drop: svelte-dnd-action.
- Tests: Vitest for `core` and extension logic, Playwright with a loaded extension for Chromium end to end, and a GUI run for Firefox (`docs/guides/firefox-check.md`).
- Lint and format: oxlint, oxfmt.
- Server (`P4`): Go and Postgres in `apps/server`.

## Phases

### P1: classic OneTab core

Built. Every `P1` item in `docs/specs/features.md` works in Chrome and Firefox.

### P2: v2 organization

Built, in Chrome and Firefox. The steps below record what each one built.

Steps run in this order. Each step is done when its check passes plus `pnpm test`, `pnpm test:e2e`, `pnpm check`, and `pnpm lint`. A value marked *(savetab choice)* has no observed OneTab counterpart.

1. **Data model.** Shape changes land before any UI.
   - `Link` record: `{ id, kind: 'link', url, title, notes, purged }`. `url` is the normalized URL: `new URL(raw).href`, or the raw string when parsing fails. `id` is `link-` plus a 106-bit hex hash of the normalized URL (two cyrb53 runs with different seeds). It is synchronous, since a Dexie transaction commits on any non-IndexedDB await. Two devices that store the same URL make the same id, so their writes merge.
   - A tab shows its `Link` title when the `Link` exists, else its own `Tab.title`. Storing a tab creates the `Link` with the tab's title when none exists. `titleOnDuplicate: 'update'` writes the `Link` title. Renaming or noting a tab writes the `Link`.
   - Emptying trash purges a `Link` when no live or trashed tab has its URL.
   - `ItemBase` adds `collapsed: boolean` and `quickOrder: string | null` (fractional key in the quick list, null = not listed).
   - Synced settings add `copyFormat: 'rich' | 'urlTitle' | 'titleUrl' | 'url' | 'markdown'` (default `rich`).
   - `NOTES_MAX = 5000` characters *(savetab choice)*.
   - Check: core tests show two copies of a URL sharing a renamed title and notes, two devices converging on one `Link`, and an orphan `Link` purged with the trash.
2. **Folders and navigation column.** The page shows one folder at a time: its folders, then its groups, in display order. A left column lists the folder tree, recent folders and groups (last 10 opened, device setting), and a filter: show everything, folders only, named only. A breadcrumb leads back to root. "New folder" creates a folder at the top of the current folder. Dragging a group onto a folder in the column moves it there. New stores still land at the root.
   - Check: e2e makes a folder, moves a group into it, opens it, and returns to root through the breadcrumb.
3. **Item menus and flags.** One menu component serves folder, group, and tab rows. A tab row gets a "More" button shown on hover and focus, like the delete cross.
   - Rename, notes (text area capped at `NOTES_MAX`, shown under the title), star, make task / mark done / remove task, mark archived (weak text on the border-color background: stylelint rejects striped gradients as a tell), pin to top, lock.
   - Create group or folder above, within, below. An empty new group gets the title "New group" and opens in edit mode, since an empty unnamed group is not shown.
   - Merge into parent (folder: children move to its parent, then the folder goes to trash). Merge with inner groups (folder: every group below it merges into its first group).
   - Remove duplicates: within here, here that exist elsewhere, elsewhere that exist here. Duplicates compare normalized URLs. The first copy in display order stays. Removed copies go to trash.
   - Copy links to clipboard in `copyFormat`: `URL | Title`, `Title URL`, URL only, Markdown `[Title](URL)`, or rich text (`text/html` links plus a plain-text fallback). The options page sets `copyFormat`.
   - The emoji picker shortcut on notes goes to `docs/candidates.md`: features.md does not say what it does.
   - Check: core tests for merge and each remove-duplicates variant, e2e for adding a tab note that shows on a second copy of the URL.
4. **Move and copy.** A location chooser dialog lists folders and groups with a search field. Move uses `moveItems`. Copy duplicates items and their subtrees with new ids. Dragging with Ctrl or Alt held copies instead of moving. Dropping a group on another group's entry in the folder column merges its tabs into that group. The main list reorders under the pointer, so a header there moves away before the drop lands.
   - Check: core tests for copy (new ids, same `Link`) and group merge, e2e for "Move" through the dialog.
5. **Multi-select and bulk actions.** A tick before each tab and group head toggles selection. Right-click on a tick opens: Select all, Deselect all, Invert selection, Select all except this, Select this and above, Select this and below, in the current view's order. A bar shows the count and actions: Restore, Move, Copy, Star, Archive, Make task, Copy links, Move to trash. Restoring more than 50 tabs asks "You are about to open {N} tabs". One open is capped at 500 tabs.
   - Check: unit tests for the selection commands, e2e for select all and bulk trash.
6. **Search.** A header field with a match count. Terms match the shown title, URL, and notes of tabs, groups, and folders. Filters: case sensitive, whole words, created on or after, created on or before, starred, tasks, has notes, named only, archived / non-archived / both, restrict to a folder. Results show matching tabs under their groups. Omnibox keyword `11` lists the top 6 matches as suggestions. Choosing a suggestion opens its URL. Pressing Enter on typed text opens the page with `?q=<text>`. The search function lives in `core`.
   - Check: core tests for each filter, e2e for typing a term and reading the count.
7. **Sort, collapse, paging.** A "Sort groups" control in the folder bar sorts the current folder's groups, root included: A-Z, recently created, recently modified, recently accessed, each with reverse. Sorting rewrites order keys, so it syncs. Tabs keep their order. The collapse toggle on a group or folder head writes `collapsed`. A collapsed group hides its tabs. A collapsed folder hides its subtree in the folder column. A folder shows 50 groups per page with "Next {N}" and "Previous {N}" *(savetab choice: page size)*.
   - Check: core test for each sort key, e2e for collapse and paging.
8. **Keyboard navigation.** Tab enters the list on the first row. Up and Down move between rows, Enter opens a tab or restores a group, Left collapses and Right expands, Backspace goes to the parent folder, Esc leaves the list. `/` focuses search, `Alt+/` focuses search restricted to the current folder *(savetab choice: the key)*.
   - Check: e2e drives each key.
9. **Tasks view and quick list.** A header link "Tasks ({pending} pending, {done} done)" opens a view of tasks, pending first, each with a done toggle. Tab and group menus get "Add to quick list" and "Remove from quick list", since the quick list holds tabs and groups (features.md). The quick list shows in the navigation column under the folder tree, in `quickOrder`. Removing an entry clears `quickOrder` and leaves the item.
   - Check: e2e marks a task done and adds and removes a quick list entry.
10. **Send to a group from the context menu.** A "Send this tab to" submenu lists the 5 most recent destination groups, then named groups that are not locked, up to 20 entries. Recent folders and locked groups are skipped. The menu rebuilds when an entry changes, such as a group title. The recent destination list is a device setting, updated by each send and each move through the location dialog.
    - Check: e2e sends a tab to a named group through the menu click handler.

### P3: v2 capture and restore extras

Built, in Chrome and Firefox. The steps below record what each one built.

Steps run in this order. Each step is done when its check passes plus `pnpm test`, `pnpm test:e2e`, `pnpm check`, and `pnpm lint`. A value marked *(savetab choice)* has no observed OneTab counterpart. Locales land before the steps that add UI, so new strings go straight into both message files. The Chrome and Firefox API differences each step relies on are in `docs/specs/browser-apis.md`.

1. **Data model and settings.** Shape changes land before any UI.
   - `GroupFields` adds `openAs: { mode: 'window' | 'tabGroup'; color: TabGroupColor; collapsed: boolean }` (default `{ mode: 'window', color: 'grey', collapsed: false }`) and `restoreTarget: 'default' | 'current' | 'new' | 'incognito'` (default `'default'`). `TabGroupColor` is `'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange'`, Chrome's set. A record without these fields reads as the default.
   - Synced settings add `tabGroupRestore: 'current' | 'new'` (default `'current'`) and `discardOnOpen: boolean` (default `false`).
   - `DeviceSettings` adds `theme: 'auto' | 'light' | 'dark'` (default `'auto'`) and `language: 'auto' | 'en' | 'ko'` (default `'auto'`). `toolbarAction` adds `'popup'`.
   - `NewTab` adds optional `pinned`. Storing a pinned tab writes `pinOnOpen: true`.
   - `ListView` fills a group record's missing `openAs` and `restoreTarget` with the defaults, so every reader sees both fields.
   - Check: core tests show a stored pinned tab with `pinOnOpen`, and an old group record reading as the default `openAs` and `restoreTarget`.
2. **Locales.** `apps/extension/locales/en.json` and `ko.json` hold every UI string as flat camelCase keys with `{name}` placeholders. A count string has `_one` and `_other` keys, picked by `Intl.PluralRules`. `lib/i18n.ts` exports `t(key, vars?)` and `tn(key, n, vars?)`, reads the device `language`, and resolves `'auto'` from `browser.i18n.getUILanguage()`: `ko*` maps to `ko`, everything else to `en`. A missing `ko` key falls back to `en`. `browser.i18n.getMessage` is not used for page text, because the browser does not let an extension switch its language at runtime.
   - Pages, context menus, the omnibox, and dialogs all call `t`. The background rebuilds menus when `language` changes.
   - The manifest name, description, and command descriptions use `__MSG_*__` from `public/_locales/{en,ko}/messages.json`, with `default_locale: 'en'`. These follow the browser language only.
   - The options page gets a Language choice: Automatic, English, 한국어.
   - A unit test checks that `en.json` and `ko.json` have the same keys.
   - Check: e2e sets `language: 'ko'` and reads the Korean page total and a Korean group menu entry.
3. **Themes.** `DESIGN.md` and `tokens.css` add a dark palette *(savetab choice)*: surface `#202124`, on-surface `#e3e3e3`, on-surface-weak `#9aa0a6`, border `#3c4043`, primary `#8ab4f8`, primary-tint `#2a3243`, danger `#f28b82`. Each text color keeps 4.5:1 on its surface. The dark values apply under `prefers-color-scheme: dark` when `<html>` has no `data-theme`, and always under `data-theme="dark"`. `lib/theme.ts` sets `data-theme` on every extension page from the device `theme`, and removes it for `'auto'`. A header button in the list page cycles Automatic, Light, Dark and shows the current one as text.
   - Check: e2e switches to Dark and reads the computed `--color-surface` on the list page.
4. **Restore targets, pinned and discarded tabs, placeholder page.**
   - The group menu gets Restore in this window, Restore in a new window, Restore in a new incognito window. Choosing one writes the group's `restoreTarget`. Restore all and a title click on that group then use `restoreTarget` instead of `restoreGroupTarget`, until the group menu's "Use default restore" sets it back to `'default'`.
   - Incognito: `browser.extension.isAllowedIncognitoAccess()` runs first. When false, the page shows "Allow savetab in private windows on the browser's extensions page" and opens nothing. When true, `browser.windows.create({ incognito: true, url: urls })` opens the tabs. A stored tab from an incognito window is stored like any other tab, once the user allows the extension there.
   - The tab menu gets "Pin tab when opened", a toggle on `pinOnOpen`. `restore.ts` already passes `pinned: t.pinOnOpen`.
   - Discard on open: with `discardOnOpen`, each restored tab except the active one opens unloaded. Firefox passes `discarded: true` and `title` to `tabs.create`. Chrome creates the tab with `active: false`, waits for its first `tabs.onUpdated` with a `url`, then calls `tabs.discard`. A failed discard leaves the tab loaded and logs a warning. The options page gets "Discard tabs on open".
   - Placeholder page: a new `placeholder` entrypoint shows the URL in a read-only field, a Copy button, and "Your browser does not let extensions open this address. Copy it into the address bar." When `tabs.create` rejects a URL, `restore.ts` opens `placeholder.html?url=<encoded>` in its place. The tab stays listed: the after-restore rule applies only to tabs that opened their own URL *(savetab choice)*.
   - Check: unit test for the choice between `restoreTarget` and `restoreGroupTarget`, e2e for "Restore in a new window" sticking to the group and for `about:config` or `chrome://crash` opening the placeholder page.
5. **Browser tab groups.** The manifest adds the `tabGroups` permission. Code that touches `browser.tabGroups` checks that it exists first, and treats a missing API as no tab groups.
   - `NewTab` adds optional `browserGroup: { title: string; color: TabGroupColor; collapsed: boolean } | null`.
   - Storing: `capture.ts` reads each tab's `groupId`, and `tabGroups.get` for its title, color, and collapsed state. Tabs in one browser tab group become one savetab group with that title and `openAs: { mode: 'tabGroup', ... }`. The ungrouped tabs of the same store become one plain group. The groups keep the window's tab order, the first at the top *(savetab choice: OneTab's split is not observed)*. A single-tab send ignores browser tab groups.
   - Restoring a group with `openAs.mode === 'tabGroup'` opens its tabs, calls `tabs.group({ tabIds, createProperties: { windowId } })`, then `tabGroups.update` with title, color, and collapsed. `tabGroupRestore` picks the current window or a new one.
   - The group menu gets "Open as browser tab group", a toggle on `openAs.mode`, with a color choice from `TabGroupColor` and a "Collapsed" toggle.
   - Check: unit test for splitting a window's tabs by `groupId`, e2e that stores a window with one browser tab group and restores it as a tab group with its title and color.
6. **Rich text, dropped links, bookmarks, reading list.**
   - `lib/links-in.ts` turns `text/html` into `LinkLine[]` with `DOMParser` (every `<a href>` with an `http`, `https`, or `ftp` scheme, its text as the title), and `text/uri-list` or plain text into lines through `parseImportText`.
   - The import page's text area takes a rich text paste: when the clipboard has `text/html`, its links replace the pasted text as `URL | Title` lines.
   - The list page takes a drop of text or links from outside the extension: the links become a new group at the top of the current folder. A drop that carries savetab's own drag data keeps its P2 meaning.
   - Bookmarks: the import page gets "Import bookmarks". `bookmarks` is an optional permission, requested in the button's click handler. A folder picker lists the bookmark tree. Each chosen bookmark folder becomes a savetab folder at the root, its sub-folders become sub-folders, and the bookmarks directly inside a folder become one group in it.
   - Reading list (Chrome only, hidden where `browser.readingList` is missing): "Import reading list", behind the optional `readingList` permission, stores every entry as one group at the root.
   - Check: unit tests for HTML and uri-list parsing, e2e for a rich text paste and a bookmark folder import. Permission prompts cannot be clicked in Playwright, so the e2e build grants `bookmarks` as a required permission.
7. **Save as HTML.** The folder and group menus get "Save as HTML file". `core` `exportHtml(view, id)` returns one standalone HTML page: the item's title as `<h1>`, each group as an `<h2>` with its title or "{N} tabs", each tab as a link with its shown title, notes as text under it, and inline styles only. The page downloads it as `<title or savetab>.html` through a Blob URL and an `<a download>` click, then revokes the URL.
   - Check: core test for `exportHtml` escaping and nesting, e2e catching the download and reading its links. The Firefox check confirms the file downloads instead of opening. When it opens instead, stop and ask: the fallback is the `downloads` permission.
8. **Action popup.** With `toolbarAction: 'popup'`, the background calls `browser.action.setPopup({ popup: 'send.html' })`, and an empty popup for every other value. The `send` entrypoint lists the current window's tabs with ticks, all ticked except the ones the filters hide.
   - Filters, each a checkbox: include pinned (off), include grouped in a browser tab group (on), include already stored (on), and per-domain lines that untick every tab of a host.
   - Destination: "New group" (default) with a group title field, or an existing group chosen from a search field over group titles, showing the recent destinations from P2 step 10 first. `/` focuses the destination search.
   - Actions: "Send N tabs" stores the ticked tabs into the destination and closes them. "Close tabs already stored in savetab" closes open tabs whose normalized URL is already listed. "Close these duplicates" closes every open tab whose normalized URL repeats an earlier open tab. "Merge open tabs here", shown when the destination is an existing group, stores the ticked tabs into it.
   - The entrypoint is not named `popup`: WXT would make a `popup` entrypoint the manifest's `default_popup`, and `action.onClicked` would never fire.
   - Check: e2e opens `send.html` in a tab with a window id query parameter for the e2e build, unticks one tab, sends to a named group, and reads the list.
9. **Weekly local backup.** The manifest adds `alarms`. An alarm `weekly-backup` every 7 days writes `{ takenAt, records }` (every item record, links and settings included) to `browser.storage.local` under `backup`. Startup checks for data loss: when `db.items` holds no record and `backup` holds records, `core` `restoreSnapshot(tx, records)` writes them back inside `transact`, and the list page shows "Your list was restored from the backup of {date}". The options page shows the last backup time and a "Back up now" button. Uninstall clears both stores, so the backup covers lost IndexedDB data, not a reinstall.
   - Check: unit test for `restoreSnapshot`, e2e that backs up, clears `db.items`, stops the background worker through CDP, and reads the restored list. `chrome.runtime.reload()` would unload an extension loaded with `--load-extension`.
10. **Firefox check.** Run `docs/guides/firefox-check.md` over the P3 pages: Korean locale, dark theme, the three restore targets, discard on open, the placeholder page, storing and restoring a browser tab group (Firefox 139 or later), a rich text paste, a bookmark import with the real permission prompt, Save as HTML, the popup, and Back up now. Done when each works in Firefox or a failure is written down.

### P4: sync server

Multi-user accounts, device registration, op push and pull with HLC merge, Postgres schema, share as a web page.

Login is OIDC. The server is the relying party for any configured issuer, and maps `(issuer, sub)` to a user in its own table so other login methods can join later. The extension runs authorization code with PKCE through `browser.identity.launchWebAuthFlow`. The server then issues its own per-device access and refresh tokens. IdP tokens never reach the extension.

Open before starting: whether ops are end-to-end encrypted. The E2E design under consideration:
- A random AES-256-GCM data key, made on the first device, encrypts every op. The server stores only wrapped copies.
- A new device gets the data key through device pairing (ECDH P-256 with a 6-digit confirmation code) or a one-time random recovery key.
- The server keeps an append-only log `ops(user_id, seq, device_id, ciphertext, created_at)` and never merges. Clients decrypt and merge. AAD binds `user_id` and `item_id`. Clients upload encrypted snapshots, and the server drops ops before the snapshot's `seq`.
- A shared web page uses its own random key in the URL fragment.
Without E2E, the server runs the same merge rule as the client.

### P5: more clients

Safari through WXT's Safari build and Xcode. Mobile client reusing `core`.

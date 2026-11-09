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
4. **Move and copy.** A location chooser dialog lists folders and groups with a search field. Move uses `moveItems`. Copy duplicates items and their subtrees with new ids. Dragging with Ctrl or Alt held copies instead of moving. Dropping a group on another group's header merges its tabs into that group.
   - Check: core tests for copy (new ids, same `Link`) and group merge, e2e for "Move" through the dialog.
5. **Multi-select and bulk actions.** A tick before each tab and group head toggles selection. Right-click on a tick opens: Select all, Deselect all, Invert selection, Select all except this, Select this and above, Select this and below, in the current view's order. A bar shows the count and actions: Restore, Move, Copy, Star, Archive, Make task, Copy links, Move to trash. Restoring more than 50 tabs asks "You are about to open {N} tabs". One open is capped at 500 tabs.
   - Check: unit tests for the selection commands, e2e for select all and bulk trash.
6. **Search.** A header field with a match count. Terms match the shown title, URL, and notes of tabs, groups, and folders. Filters: case sensitive, whole words, created on or after, created on or before, starred, tasks, has notes, named only, archived / non-archived / both, restrict to a folder. Results show matching tabs under their groups. Omnibox keyword `11` lists the top 6 matches as suggestions. Choosing a suggestion opens its URL. Pressing Enter on typed text opens the page with `?q=<text>`. The search function lives in `core`.
   - Check: core tests for each filter, e2e for typing a term and reading the count.
7. **Sort, collapse, paging.** The folder menu sorts its groups: A-Z, recently created, recently modified, recently accessed, each with reverse. Sorting rewrites order keys, so it syncs. Tabs keep their order. The collapse toggle on a group or folder head writes `collapsed`. A folder shows 50 groups per page with "Next {N}" and "Previous {N}" *(savetab choice: page size)*.
   - Check: core test for each sort key, e2e for collapse and paging.
8. **Keyboard navigation.** Tab enters the list on the first row. Up and Down move between rows, Enter opens a tab or restores a group, Left collapses and Right expands, Backspace goes to the parent folder, Esc leaves the list. `/` focuses search, `Alt+/` focuses search restricted to the current folder *(savetab choice: the key)*.
   - Check: e2e drives each key.
9. **Tasks view and quick list.** A header link "Tasks ({pending} pending, {done} done)" opens a view of tasks, pending first, each with a done toggle. Item menus get "Add to quick list" and "Remove from quick list". The quick list shows in the navigation column under the folder tree, in `quickOrder`. Removing an entry clears `quickOrder` and leaves the item.
   - Check: e2e marks a task done and adds and removes a quick list entry.
10. **Send to a group from the context menu.** A "Send this tab to" submenu lists the 5 most recent destinations, then named groups that are not locked, up to 20 entries. The menu rebuilds when a group title changes. The recent destination list is a device setting, updated by each send and move.
    - Check: e2e sends a tab to a named group through the menu click handler.

### P3: v2 capture and restore extras

Action popup, browser tab groups, incognito restore, discard on open, placeholder page, rich text and drag-in link import, bookmarks and reading list import, save as HTML, themes, ko and en locales, weekly local backup.

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

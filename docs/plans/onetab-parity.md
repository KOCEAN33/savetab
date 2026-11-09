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
  clocks: Record<string, Hlc>;    // last-writer-wins clock per field
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

Title and notes sharing across copies of one URL (features.md "Data hierarchy") is a `P2` change: titles and notes move to a `Link` record keyed by normalized URL. `P1` keeps them on `Tab`.

Merge rule for incoming ops: a field takes the op's value when the op's HLC is greater than the field's clock. Clients run this rule. Whether the server also runs it depends on the E2E decision in `P4`.

## Stack

- pnpm workspace. `packages/core` (TypeScript, data model, mutations, merge, import and export parsing). `apps/extension` (WXT, Svelte 5, TypeScript).
- WXT builds MV3 for Chrome and Firefox from one source, and has a Safari build path for `P5`.
- IndexedDB through Dexie. `liveQuery` pushes changes to every open OneTab page.
- Drag and drop: svelte-dnd-action.
- Tests: Vitest for `core`, Playwright with a loaded extension for Chromium end to end, `web-ext` run for Firefox smoke.
- Lint and format: oxlint, oxfmt.
- Server (`P4`): Go and Postgres in `apps/server`.

## Phases

### P1: classic OneTab core

Steps in order:

1. Workspace scaffold: pnpm, TypeScript, oxlint, oxfmt, Vitest, WXT app that loads in Chrome and Firefox.
2. `core` model: types, UUIDv7, HLC, fractional index, mutations (create, move, update field, trash, purge), outbox, merge. Unit tests.
3. Storage adapter: Dexie schema for items, outbox, settings. Live queries.
4. Capture: background worker with every store action from features.md "Storing tabs" except the popup. Context menu, keyboard commands, pinned, excluded domains, duplicates, title rule.
5. OneTab page: header with total, group list, tab rows, restore and delete with modifier keys, Restore all with confirm limit, rename, lock, star, pin to top, trash view.
6. Drag and drop: reorder tabs and groups, move tabs between groups, drop into blank space for a new group.
7. Options page: every `P1` row of the options table.
8. Import and export page: `URL | Title` text both ways.
9. Startup and lifecycle: open at startup, "Open OneTab" window rule, page reload on extension update.

Done when:
- `pnpm test` passes, covering merge convergence for any two op orders, order keys, import and export round trip.
- A Playwright run on Chromium stores a window of 5 tabs, restores one, restores all, and checks the remove, keep, and locked rules.
- The Firefox build loads with `web-ext run` and the toolbar action stores tabs.

### P2: v2 organization

Folders and navigation column, `Link` records for shared titles and notes, notes, search with filters, omnibox `11`, multi-select and bulk actions, sort, collapse, paging, keyboard navigation, quick list, tasks view, archive, move and copy dialogs, merge actions, remove-duplicates tools, copy to clipboard formats.

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

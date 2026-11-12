import { uuidv7 } from './id';
import { linkId, normalizeUrl } from './link';
import {
  EXCLUDE_PREFIX,
  isKind,
  isLive,
  isSyncField,
  readSettings,
  SETTINGS_ID,
  type CommonFields,
  type GroupFields,
  type Id,
  type ItemRecord,
  type Settings,
  type SettingsFields,
  type TabFields,
  type TabGroupColor,
} from './model';
import { keyOrdered, orderKeys, TOP, type Before } from './order';
import { compareSiblings, liveChildren } from './query';
import type { Tx } from './tx';

export class LockedError extends Error {
  constructor() {
    super('The group is locked');
  }
}

export class MissingError extends Error {
  constructor() {
    super('The destination no longer exists');
  }
}

export class CycleError extends Error {
  constructor() {
    super('A folder cannot move into itself');
  }
}

export interface NewTab {
  url: string;
  title: string;
  favIconUrl: string;
  /** Pinned in the browser when stored. The stored tab then opens pinned. */
  pinned?: boolean;
  /** The browser tab group the tab was in. Tabs sharing an `id` store as one group. */
  browserGroup?: BrowserGroup | null;
}

export interface BrowserGroup {
  /** The browser's group id, used only to split one store into groups. */
  id: number;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Store rules from OneTab: pinned tabs and excluded hosts are skipped, except when the user
 * sends one specific tab. URLs under `ignorePrefixes` (savetab's own pages) are always skipped.
 */
export function filterStorable<T extends NewTab & { pinned: boolean }>(
  tabs: T[],
  settings: Settings,
  opts: { single: boolean; ignorePrefixes: string[] },
): T[] {
  const excluded = new Set(settings.excludedDomains);
  return tabs.filter((t) => {
    if (opts.ignorePrefixes.some((p) => t.url.startsWith(p))) return false;
    if (opts.single) return true;
    if (t.pinned && settings.pinnedTabs === 'skip') return false;
    return !excluded.has(hostname(t.url));
  });
}

function baseFields(tx: Tx, parentId: Id | null, order: string) {
  return {
    parentId,
    order,
    createdAt: tx.now,
    modifiedAt: tx.now,
    accessedAt: null,
    trashedAt: null,
    purged: false,
    title: '',
    notes: '',
    star: false,
    collapsed: false,
  };
}

async function createGroupAtTop(
  tx: Tx,
  parentId: Id | null,
  title = '',
  extra: Partial<GroupFields> = {},
  id: Id = uuidv7(tx.now),
): Promise<Id> {
  const [order] = await orderKeys(tx, parentId, TOP, 1);
  await tx.write(id, {
    ...baseFields(tx, parentId, order!),
    kind: 'group',
    title,
    pinnedTop: false,
    locked: false,
    ...extra,
  });
  return id;
}

export async function createFolder(tx: Tx, parentId: Id | null, title: string): Promise<Id> {
  const [order] = await orderKeys(tx, parentId, TOP, 1);
  const id = uuidv7(tx.now);
  await tx.write(id, {
    ...baseFields(tx, parentId, order!),
    kind: 'folder',
    title,
    pinnedTop: false,
  });
  return id;
}

async function isInLockedGroup(tx: Tx, rec: ItemRecord): Promise<boolean> {
  if (rec.kind !== 'tab' || rec.parentId == null) return false;
  const parent = await tx.get(rec.parentId);
  return isKind(parent, 'group') && parent.locked === true && parent.purged !== true;
}

/** OneTab drops a group once its last tab leaves. A named group stays, since the user gave it a purpose. */
async function trashIfEmpty(tx: Tx, groupId: Id | null | undefined): Promise<void> {
  if (groupId == null) return;
  const g = await tx.get(groupId);
  if (!isKind(g, 'group') || !isLive(g) || g.locked || g.title) return;
  if ((await tx.children(groupId)).some(isLive)) return;
  await tx.write(groupId, { trashedAt: tx.now, modifiedAt: tx.now });
}

/** Create the URL's link when missing, seeded with `title`. Returns the live link. */
async function ensureLink(tx: Tx, url: string, title: string): Promise<ItemRecord> {
  const id = linkId(url);
  const link = await tx.get(id);
  if (isKind(link, 'link') && link.purged !== true) return link;
  return tx.write(id, { kind: 'link', url: normalizeUrl(url), title, notes: '', purged: false });
}

/** Apply the duplicate and title rules and the URL's link. Returns the tabs that should be added. */
async function acceptTabs(tx: Tx, tabs: NewTab[], settings: Settings): Promise<NewTab[]> {
  const accepted: NewTab[] = [];
  const seen = new Set<string>();
  for (const raw of tabs) {
    const tab = { ...raw, url: normalizeUrl(raw.url) };
    const copies = (await tx.byUrl(tab.url)).filter((r) => r.kind === 'tab' && isLive(r));
    // A copy stored before links existed holds the title "keep" refers to.
    const link = await ensureLink(tx, tab.url, copies[0]?.title ?? tab.title);
    if (settings.titleOnDuplicate === 'update' && tab.title && link.title !== tab.title) {
      await tx.write(link.id, { title: tab.title });
    }
    if (settings.duplicates === 'reject' && (copies.length > 0 || seen.has(tab.url))) continue;
    seen.add(tab.url);
    accepted.push(tab);
  }
  return accepted;
}

/** Insert tabs at the top of a group, keeping their given order. */
async function insertTabs(tx: Tx, groupId: Id, tabs: NewTab[]): Promise<void> {
  const keys = await orderKeys(tx, groupId, TOP, tabs.length);
  for (const [i, tab] of tabs.entries()) {
    await tx.write(uuidv7(tx.now), {
      ...baseFields(tx, groupId, keys[i]!),
      kind: 'tab',
      url: normalizeUrl(tab.url),
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      pinOnOpen: tab.pinned === true,
    });
  }
}

/**
 * Store tabs as new groups at the top of the root list: one per browser tab group, opening as a
 * tab group again, and one plain group for the rest. The groups keep the order of their first
 * tab. Returns the top group, or null when every tab was rejected.
 */
export async function storeTabs(tx: Tx, tabs: NewTab[], settings: Settings): Promise<Id | null> {
  const accepted = await acceptTabs(tx, tabs, settings);
  const parts = new Map<number | null, NewTab[]>();
  for (const tab of accepted) {
    const key = tab.browserGroup?.id ?? null;
    parts.set(key, [...(parts.get(key) ?? []), tab]);
  }
  let top: Id | null = null;
  for (const part of [...parts.values()].reverse()) {
    const bg = part[0]!.browserGroup;
    top = await createGroupAtTop(
      tx,
      null,
      bg?.title ?? '',
      bg ? { openAs: { mode: 'tabGroup', color: bg.color, collapsed: bg.collapsed } } : {},
    );
    await insertTabs(tx, top, part);
  }
  return top;
}

/**
 * OneTab's single-tab send: the tab joins the first root group that is neither pinned nor locked,
 * or a new group when none exists.
 */
export async function storeIntoFirstGroup(tx: Tx, tabs: NewTab[], settings: Settings): Promise<Id | null> {
  const target = (await liveChildren(tx, null)).find((g) => g.kind === 'group' && !g.pinnedTop && !g.locked);
  if (!target) return storeTabs(tx, tabs, settings);
  const accepted = await acceptTabs(tx, tabs, settings);
  if (accepted.length === 0) return null;
  await insertTabs(tx, target.id, accepted);
  return target.id;
}

/** "Send this tab to": the tabs join the top of a chosen group. */
export async function storeIntoGroup(tx: Tx, groupId: Id, tabs: NewTab[], settings: Settings): Promise<void> {
  const group = await tx.get(groupId);
  if (!isKind(group, 'group') || !isLive(group)) throw new MissingError();
  if (group.locked) throw new LockedError();
  const accepted = await acceptTabs(tx, tabs, settings);
  if (accepted.length > 0) await insertTabs(tx, groupId, accepted);
}

/** The fields a user edits in place. Placement, trash state, and dates change through their own mutations. */
export type ItemPatch = Partial<
  Pick<CommonFields, 'title' | 'notes' | 'star' | 'collapsed'> &
    Pick<GroupFields, 'pinnedTop' | 'locked' | 'openAs' | 'restoreTarget'> &
    Pick<TabFields, 'pinOnOpen'>
>;

const EDITABLE: ReadonlySet<string> = new Set<keyof ItemPatch>([
  'title',
  'notes',
  'star',
  'collapsed',
  'pinnedTop',
  'locked',
  'openAs',
  'restoreTarget',
  'pinOnOpen',
]);

export async function updateItem(tx: Tx, id: Id, patch: ItemPatch): Promise<void> {
  const bad = Object.keys(patch).find((f) => !EDITABLE.has(f));
  if (bad !== undefined) throw new Error(`Field ${bad} cannot be edited in place`);
  await tx.write(id, { ...patch, modifiedAt: tx.now });
}

/** Change synced settings. `excludedDomains` is the whole list: hosts it adds or drops are written one field each. */
export async function updateSettings(tx: Tx, patch: Partial<Omit<SettingsFields, 'kind'>>): Promise<void> {
  const { excludedDomains, ...fields }: Record<string, unknown> & { excludedDomains?: string[] } = patch;
  if (excludedDomains) {
    const have = readSettings(await tx.get(SETTINGS_ID)).excludedDomains;
    for (const host of excludedDomains) if (!have.includes(host)) fields[EXCLUDE_PREFIX + host] = true;
    for (const host of have) if (!excludedDomains.includes(host)) fields[EXCLUDE_PREFIX + host] = false;
  }
  await tx.write(SETTINGS_ID, { kind: 'settings', ...fields });
}

/** Move items under `parentId`, placed just before `beforeId`, at the top for `TOP`, or at the end when it is null. */
export async function moveItems(tx: Tx, ids: Id[], parentId: Id | null, beforeId: Before): Promise<void> {
  const target = parentId == null ? undefined : await tx.get(parentId);
  if (parentId != null && !isLive(target)) throw new MissingError();
  if (isKind(target, 'group') && target.locked) throw new LockedError();
  for (let at: ItemRecord | undefined = target; at; at = at.parentId == null ? undefined : await tx.get(at.parentId)) {
    if (ids.includes(at.id)) throw new CycleError();
  }
  const moving: ItemRecord[] = [];
  for (const id of ids) {
    const rec = await tx.get(id);
    if (!rec) continue;
    if (await isInLockedGroup(tx, rec)) throw new LockedError();
    moving.push(rec);
  }

  const keys = await orderKeys(tx, parentId, beforeId, moving.length, new Set(ids));
  for (const [i, rec] of moving.entries()) {
    await tx.write(rec.id, { parentId, order: keys[i]!, modifiedAt: tx.now });
  }
  for (const source of new Set(moving.map((r) => r.parentId))) {
    if (source !== parentId) await trashIfEmpty(tx, source);
  }
}

/** Imported groups go to the top of `parentId`, keeping the text's order. Duplicate rules do not apply. */
export async function importGroups(tx: Tx, groups: NewTab[][], parentId: Id | null = null): Promise<Id[]> {
  const ids: Id[] = [];
  for (const tabs of [...groups].reverse()) {
    if (tabs.length === 0) continue;
    const id = await createGroupAtTop(tx, parentId);
    await insertTabs(tx, id, tabs);
    ids.unshift(id);
  }
  return ids;
}

export interface BookmarkFolder {
  title: string;
  /** The bookmarks directly inside this folder. */
  links: NewTab[];
  folders: BookmarkFolder[];
}

/**
 * A bookmark folder becomes a savetab folder at the top of `parentId`: its sub-folders become
 * sub-folders in order, and its direct bookmarks one group below them. Returns the folder.
 */
export async function importBookmarks(tx: Tx, node: BookmarkFolder, parentId: Id | null = null): Promise<Id> {
  const id = await createFolder(tx, parentId, node.title);
  await importGroups(tx, [node.links], id);
  for (const sub of [...node.folders].reverse()) await importBookmarks(tx, sub, id);
  return id;
}

/** OneTab's "drag tabs into blank space": the tabs form a new group at the top of `parentId`. */
export async function moveToNewGroup(tx: Tx, ids: Id[], parentId: Id | null = null): Promise<Id> {
  const groupId = await createGroupAtTop(tx, parentId);
  await moveItems(tx, ids, groupId, null);
  return groupId;
}

/** True when the item is a locked group or a folder holding one at any depth. */
async function holdsLock(tx: Tx, rec: ItemRecord): Promise<boolean> {
  if (isKind(rec, 'group')) return rec.locked === true;
  if (rec.kind !== 'folder') return false;
  for (const child of (await tx.children(rec.id)).filter(isLive)) if (await holdsLock(tx, child)) return true;
  return false;
}

export async function trashItems(tx: Tx, ids: Id[]): Promise<void> {
  const recs: ItemRecord[] = [];
  for (const id of ids) {
    const rec = await tx.get(id);
    if (!rec) continue;
    if ((await holdsLock(tx, rec)) || (await isInLockedGroup(tx, rec))) throw new LockedError();
    recs.push(rec);
  }
  for (const rec of recs) await tx.write(rec.id, { trashedAt: tx.now, modifiedAt: tx.now });
  for (const rec of recs) if (rec.kind === 'tab') await trashIfEmpty(tx, rec.parentId);
}

/**
 * Move a live item out from under a purged parent, to the top of the root, a tab into a group
 * there. The group's id comes from the purged parent, so devices that re-home tabs of one parent
 * at the same time make one group. Once the user has trashed that group, a later tab gets a fresh
 * one, and two devices re-homing then can each leave a group.
 */
export async function rehome(tx: Tx, rec: ItemRecord): Promise<void> {
  if (!isLive(rec) || rec.parentId == null) return;
  const parent = await tx.get(rec.parentId);
  if (parent?.purged !== true) return;
  if (rec.kind !== 'tab') return moveItems(tx, [rec.id], null, TOP);
  const shared = `rehome-${parent.id}`;
  const group = await tx.get(shared);
  const groupId = group === undefined || isLive(group) ? shared : uuidv7(tx.now);
  if (group === undefined || groupId !== shared) await createGroupAtTop(tx, null, '', {}, groupId);
  await moveItems(tx, [rec.id], groupId, null);
}

/**
 * Restore items with every trashed ancestor, so each is reachable from the root again. Under a
 * purged ancestor, the highest surviving item is re-homed.
 */
export async function restoreFromTrash(tx: Tx, ids: Id[]): Promise<void> {
  for (const id of ids) {
    const rec = await tx.get(id);
    if (!rec || rec.purged) continue;
    let top: ItemRecord | undefined;
    for (
      let at: ItemRecord | undefined = rec;
      at && at.purged !== true;
      at = at.parentId == null ? undefined : await tx.get(at.parentId)
    ) {
      if (at.trashedAt != null) await tx.write(at.id, { trashedAt: null, modifiedAt: tx.now });
      top = at;
    }
    if (top) await rehome(tx, (await tx.get(top.id))!);
  }
}

async function purgeTree(tx: Tx, id: Id, urls: Set<string>): Promise<void> {
  for (const child of await tx.children(id)) await purgeTree(tx, child.id, urls);
  const rec = await tx.get(id);
  if (rec?.url) urls.add(normalizeUrl(rec.url));
  const content = rec?.kind === 'tab' ? { url: '', favIconUrl: '' } : {};
  await tx.write(id, { purged: true, title: '', notes: '', ...content, modifiedAt: tx.now });
}

/** Purge the trash, and every link whose last tab went with it. */
export async function emptyTrash(tx: Tx): Promise<void> {
  const urls = new Set<string>();
  for (const rec of await tx.trashed()) await purgeTree(tx, rec.id, urls);
  for (const url of urls) {
    if ((await tx.byUrl(url)).some((r) => r.kind === 'tab' && r.purged !== true)) continue;
    const link = await tx.get(linkId(url));
    if (isKind(link, 'link') && link.purged !== true) {
      await tx.write(link.id, { purged: true, url: '', title: '', notes: '' });
    }
  }
}

/** Apply the "after restoring tabs" rule. Locked groups always keep their tabs. */
export async function afterOpen(tx: Tx, tabIds: Id[], mode: Settings['afterRestore']): Promise<void> {
  const parents = new Set<Id | null | undefined>();
  for (const id of tabIds) {
    const rec = await tx.get(id);
    if (!rec || (await isInLockedGroup(tx, rec))) continue;
    const fields: Record<string, unknown> = { accessedAt: tx.now };
    if (mode === 'remove') fields.trashedAt = tx.now;
    await tx.write(id, fields);
    parents.add(rec.parentId);
  }
  if (mode === 'remove') for (const p of parents) await trashIfEmpty(tx, p);
}

/** A tab's title and notes live on its URL's link, so the edit shows on every copy. */
export async function editTab(tx: Tx, tabId: Id, patch: { title?: string; notes?: string }): Promise<void> {
  const tab = await tx.get(tabId);
  if (!isKind(tab, 'tab')) return;
  const link = await ensureLink(tx, tab.url, tab.title);
  await tx.write(link.id, patch);
  await tx.write(tabId, { modifiedAt: tx.now });
}

/**
 * Create an empty folder or group at the top inside `anchorId`. An empty unnamed
 * group is hidden, so a new group gets a name.
 */
export async function createWithin(tx: Tx, kind: 'folder' | 'group', anchorId: Id): Promise<Id> {
  const anchor = await tx.get(anchorId);
  if (!anchor) throw new Error('The item no longer exists');
  const [order] = await orderKeys(tx, anchorId, TOP, 1);
  const id = uuidv7(tx.now);
  await tx.write(id, {
    ...baseFields(tx, anchorId, order!),
    kind,
    title: kind === 'group' ? 'New group' : '',
    pinnedTop: false,
    ...(kind === 'group' ? { locked: false } : {}),
  });
  return id;
}

/** Live children in display order. */
async function shownChildren(tx: Tx, parentId: Id | null): Promise<ItemRecord[]> {
  return (await tx.children(parentId)).filter(isLive).sort(compareSiblings);
}

/** Move a folder's contents into its parent at the folder's place, then trash the folder. */
export async function mergeIntoParent(tx: Tx, folderId: Id): Promise<void> {
  const folder = await tx.get(folderId);
  if (!isKind(folder, 'folder')) return;
  const parentId = folder.parentId ?? null;
  const siblings = await keyOrdered(tx, parentId);
  const next = siblings[siblings.findIndex((r) => r.id === folderId) + 1];
  const children = await shownChildren(tx, folderId);
  await moveItems(
    tx,
    children.map((c) => c.id),
    parentId,
    next?.id ?? null,
  );
  await trashItems(tx, [folderId]);
}

async function groupsUnder(tx: Tx, parentId: Id | null): Promise<ItemRecord[]> {
  const out: ItemRecord[] = [];
  for (const child of await shownChildren(tx, parentId)) {
    if (child.kind === 'group') out.push(child);
    if (child.kind === 'folder') out.push(...(await groupsUnder(tx, child.id)));
  }
  return out;
}

/** Move the tabs of every group under a folder into the first one, in display order. */
export async function mergeInnerGroups(tx: Tx, folderId: Id): Promise<void> {
  const [first, ...rest] = await groupsUnder(tx, folderId);
  if (!first) return;
  for (const g of rest) {
    const tabs = await shownChildren(tx, g.id);
    await moveItems(
      tx,
      tabs.map((t) => t.id),
      first.id,
      null,
    );
    if (isLive(await tx.get(g.id))) await trashItems(tx, [g.id]);
  }
}

async function tabsUnder(tx: Tx, parentId: Id | null): Promise<ItemRecord[]> {
  const out: ItemRecord[] = [];
  for (const child of await shownChildren(tx, parentId)) {
    if (child.kind === 'tab') out.push(child);
    else out.push(...(await tabsUnder(tx, child.id)));
  }
  return out;
}

/**
 * Remove duplicate tabs under `scopeId`, comparing normalized URLs. The first copy in display
 * order stays. Tabs in locked groups cannot be removed, so they are skipped. Returns the count trashed.
 */
export async function removeDuplicates(tx: Tx, scopeId: Id): Promise<number> {
  const seen = new Set<string>();
  const doomed = (await tabsUnder(tx, scopeId)).filter((t) => {
    const u = normalizeUrl(t.url ?? '');
    if (seen.has(u)) return true;
    seen.add(u);
    return false;
  });
  const removable: Id[] = [];
  for (const t of doomed) if (!(await isInLockedGroup(tx, t))) removable.push(t.id);
  await trashItems(tx, removable);
  return removable.length;
}

/** Fields a copy takes from its source. Placement and clocks stay behind. */
function copyFields(rec: ItemRecord, tx: Tx, parentId: Id | null, order: string): Record<string, unknown> {
  const fields = Object.fromEntries(Object.entries(rec).filter(([f]) => isSyncField(rec.kind!, f)));
  return { ...fields, kind: rec.kind, parentId, order, createdAt: tx.now, modifiedAt: tx.now };
}

async function copyTree(tx: Tx, rec: ItemRecord, parentId: Id | null, order: string): Promise<Id> {
  const id = uuidv7(tx.now);
  await tx.write(id, copyFields(rec, tx, parentId, order));
  for (const child of (await tx.children(rec.id)).filter(isLive)) await copyTree(tx, child, id, child.order ?? '');
  return id;
}

/** Copy items and everything under them to `parentId`, placed as `moveItems` places them. Copies of a tab share its link. */
export async function copyItems(tx: Tx, ids: Id[], parentId: Id | null, beforeId: Before): Promise<Id[]> {
  const target = parentId == null ? undefined : await tx.get(parentId);
  if (parentId != null && !isLive(target)) throw new MissingError();
  if (isKind(target, 'group') && target.locked) throw new LockedError();
  const sources: ItemRecord[] = [];
  for (const id of ids) {
    const rec = await tx.get(id);
    if (rec && isLive(rec)) sources.push(rec);
  }
  const keys = await orderKeys(tx, parentId, beforeId, sources.length);
  const out: Id[] = [];
  for (const [i, rec] of sources.entries()) out.push(await copyTree(tx, rec, parentId, keys[i]!));
  return out;
}

/** OneTab's "drop a group on a group": the source's tabs join the end of the target, and the source goes to trash. */
export async function mergeGroups(tx: Tx, sourceId: Id, targetId: Id): Promise<void> {
  if (sourceId === targetId) return;
  const tabs = await shownChildren(tx, sourceId);
  await moveItems(
    tx,
    tabs.map((t) => t.id),
    targetId,
    null,
  );
  if (isLive(await tx.get(sourceId))) await trashItems(tx, [sourceId]);
}

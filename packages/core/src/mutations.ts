import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from './id';
import { linkId, normalizeUrl } from './link';
import { isKind, isLive, type Id, type ItemRecord, type Settings } from './model';
import { compareSiblings, liveChildren } from './query';
import type { Tx } from './tx';

export class LockedError extends Error {
  constructor() {
    super('The group is locked');
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
    task: 'none',
    archived: false,
    collapsed: false,
    quickOrder: null,
  };
}

/** Siblings in key order, ignoring display pinning, so new keys always fall between neighbours. */
async function keyOrdered(tx: Tx, parentId: Id | null, exclude: Set<Id> = new Set()): Promise<ItemRecord[]> {
  return (await tx.children(parentId))
    .filter((r) => r.kind !== undefined && r.purged !== true && !exclude.has(r.id))
    .sort((a, b) => ((a.order ?? '') < (b.order ?? '') ? -1 : (a.order ?? '') > (b.order ?? '') ? 1 : 0));
}

async function createGroupAtTop(tx: Tx, parentId: Id | null, title = ''): Promise<Id> {
  const first = (await keyOrdered(tx, parentId))[0];
  const id = uuidv7(tx.now);
  await tx.write(id, {
    ...baseFields(tx, parentId, generateKeyBetween(null, first?.order ?? null)),
    kind: 'group',
    title,
    pinnedTop: false,
    locked: false,
  });
  return id;
}

export async function createFolder(tx: Tx, parentId: Id | null, title: string): Promise<Id> {
  const first = (await keyOrdered(tx, parentId))[0];
  const id = uuidv7(tx.now);
  await tx.write(id, {
    ...baseFields(tx, parentId, generateKeyBetween(null, first?.order ?? null)),
    kind: 'folder',
    title,
    pinnedTop: false,
  });
  return id;
}

async function isInLockedGroup(tx: Tx, rec: ItemRecord): Promise<boolean> {
  if (rec.kind !== 'tab' || rec.parentId == null) return false;
  const parent = await tx.get(rec.parentId);
  return isKind(parent, 'group') && parent.locked === true;
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
  const first = (await keyOrdered(tx, groupId))[0];
  const keys = generateNKeysBetween(null, first?.order ?? null, tabs.length);
  for (const [i, tab] of tabs.entries()) {
    await tx.write(uuidv7(tx.now), {
      ...baseFields(tx, groupId, keys[i]!),
      kind: 'tab',
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      pinOnOpen: false,
    });
  }
}

/** Store tabs as a new group at the top of the root list. Returns null when every tab was rejected. */
export async function storeTabs(tx: Tx, tabs: NewTab[], settings: Settings): Promise<Id | null> {
  const accepted = await acceptTabs(tx, tabs, settings);
  if (accepted.length === 0) return null;
  const groupId = await createGroupAtTop(tx, null);
  await insertTabs(tx, groupId, accepted);
  return groupId;
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

export async function updateItem(tx: Tx, id: Id, patch: Record<string, unknown>): Promise<void> {
  await tx.write(id, { ...patch, modifiedAt: tx.now });
}

/** Move items under `parentId`, placed just before `beforeId`, or at the end when it is null. */
export async function moveItems(tx: Tx, ids: Id[], parentId: Id | null, beforeId: Id | null): Promise<void> {
  const target = parentId == null ? undefined : await tx.get(parentId);
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

  const siblings = await keyOrdered(tx, parentId, new Set(ids));
  const at = beforeId == null ? siblings.length : siblings.findIndex((s) => s.id === beforeId);
  const idx = at === -1 ? siblings.length : at;
  const keys = generateNKeysBetween(siblings[idx - 1]?.order ?? null, siblings[idx]?.order ?? null, moving.length);
  for (const [i, rec] of moving.entries()) {
    await tx.write(rec.id, { parentId, order: keys[i]!, modifiedAt: tx.now });
  }
  for (const source of new Set(moving.map((r) => r.parentId))) {
    if (source !== parentId) await trashIfEmpty(tx, source);
  }
}

/** Imported groups go to the top of the list, keeping the text's order. Duplicate rules do not apply. */
export async function importGroups(tx: Tx, groups: NewTab[][]): Promise<Id[]> {
  const ids: Id[] = [];
  for (const tabs of [...groups].reverse()) {
    if (tabs.length === 0) continue;
    const id = await createGroupAtTop(tx, null);
    await insertTabs(tx, id, tabs);
    ids.unshift(id);
  }
  return ids;
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

export async function restoreFromTrash(tx: Tx, ids: Id[]): Promise<void> {
  for (const id of ids) {
    const rec = await tx.get(id);
    if (!rec || rec.purged) continue;
    await tx.write(id, { trashedAt: null, modifiedAt: tx.now });
    if (rec.kind !== 'tab') continue;
    const parent = rec.parentId == null ? undefined : await tx.get(rec.parentId);
    if (parent && parent.purged !== true) {
      if (parent.trashedAt != null) await tx.write(parent.id, { trashedAt: null, modifiedAt: tx.now });
    } else {
      await moveItems(tx, [id], await createGroupAtTop(tx, null), null);
    }
  }
}

async function purgeTree(tx: Tx, id: Id, urls: Set<string>): Promise<void> {
  for (const child of await tx.children(id)) await purgeTree(tx, child.id, urls);
  const rec = await tx.get(id);
  if (rec?.url) urls.add(rec.url);
  await tx.write(id, { purged: true, title: '', notes: '', url: '', favIconUrl: '', modifiedAt: tx.now });
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
    if (mode === 'archive') fields.archived = true;
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

export type Placement = 'above' | 'within' | 'below';

/**
 * Create an empty folder or group next to `anchorId`, or at the top inside it. An empty unnamed
 * group is hidden, so a new group gets a name.
 */
export async function createNear(tx: Tx, kind: 'folder' | 'group', anchorId: Id, where: Placement): Promise<Id> {
  const anchor = await tx.get(anchorId);
  if (!anchor) throw new Error('The item no longer exists');
  const parentId = where === 'within' ? anchorId : ((anchor.parentId as Id | null | undefined) ?? null);
  const siblings = await keyOrdered(tx, parentId);
  const at = siblings.findIndex((r) => r.id === anchorId);
  const [lo, hi] =
    where === 'within'
      ? [null, siblings[0]]
      : where === 'above'
        ? [siblings[at - 1], anchor]
        : [anchor, siblings[at + 1]];
  const id = uuidv7(tx.now);
  await tx.write(id, {
    ...baseFields(tx, parentId, generateKeyBetween(lo?.order ?? null, hi?.order ?? null)),
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

export type DuplicateScope = 'within' | 'hereElsewhere' | 'elsewhereHere';

/**
 * OneTab's three remove-duplicates tools, comparing normalized URLs. The first copy in display
 * order stays. Tabs in locked groups cannot be removed, so they are skipped. Returns the count trashed.
 */
export async function removeDuplicates(tx: Tx, scopeId: Id, scope: DuplicateScope): Promise<number> {
  const here = await tabsUnder(tx, scopeId);
  const hereIds = new Set(here.map((t) => t.id));
  const elsewhere = scope === 'within' ? [] : (await tabsUnder(tx, null)).filter((t) => !hereIds.has(t.id));
  const urls = (list: ItemRecord[]) => new Set(list.map((t) => normalizeUrl(t.url ?? '')));

  let doomed: ItemRecord[];
  if (scope === 'within') {
    const seen = new Set<string>();
    doomed = here.filter((t) => {
      const u = normalizeUrl(t.url ?? '');
      if (seen.has(u)) return true;
      seen.add(u);
      return false;
    });
  } else if (scope === 'hereElsewhere') {
    const other = urls(elsewhere);
    doomed = here.filter((t) => other.has(normalizeUrl(t.url ?? '')));
  } else {
    const mine = urls(here);
    doomed = elsewhere.filter((t) => mine.has(normalizeUrl(t.url ?? '')));
  }
  const removable: Id[] = [];
  for (const t of doomed) if (!(await isInLockedGroup(tx, t))) removable.push(t.id);
  await trashItems(tx, removable);
  return removable.length;
}

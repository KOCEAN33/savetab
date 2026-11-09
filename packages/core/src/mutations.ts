import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { uuidv7 } from './id';
import { isKind, isLive, type Id, type ItemRecord, type Settings } from './model';
import { liveChildren } from './query';
import type { Tx } from './tx';

export class LockedError extends Error {
  constructor() {
    super('The group is locked');
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

/** Apply the duplicate and title rules. Returns the tabs that should be added. */
async function acceptTabs(tx: Tx, tabs: NewTab[], settings: Settings): Promise<NewTab[]> {
  const accepted: NewTab[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    const copies = (await tx.byUrl(tab.url)).filter((r) => r.kind === 'tab' && isLive(r));
    if (settings.titleOnDuplicate === 'update' && tab.title) {
      for (const c of copies) if (c.title !== tab.title) await tx.write(c.id, { title: tab.title, modifiedAt: tx.now });
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

/** OneTab's "drag tabs into blank space": the tabs form a new group at the top. */
export async function moveToNewGroup(tx: Tx, ids: Id[]): Promise<Id> {
  const groupId = await createGroupAtTop(tx, null);
  await moveItems(tx, ids, groupId, null);
  return groupId;
}

export async function trashItems(tx: Tx, ids: Id[]): Promise<void> {
  const recs: ItemRecord[] = [];
  for (const id of ids) {
    const rec = await tx.get(id);
    if (!rec) continue;
    if ((isKind(rec, 'group') && rec.locked) || (await isInLockedGroup(tx, rec))) throw new LockedError();
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

async function purgeTree(tx: Tx, id: Id): Promise<void> {
  for (const child of await tx.children(id)) await purgeTree(tx, child.id);
  await tx.write(id, { purged: true, title: '', notes: '', url: '', favIconUrl: '', modifiedAt: tx.now });
}

export async function emptyTrash(tx: Tx): Promise<void> {
  for (const rec of await tx.trashed()) await purgeTree(tx, rec.id);
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

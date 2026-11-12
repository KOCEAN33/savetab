import { generateNKeysBetween } from 'fractional-indexing';
import { isLive, type Id, type ItemRecord } from './model';
import { compareSiblings } from './query';
import type { Tx } from './tx';

/** Placement before every child of the destination, pinned ones included. */
export const TOP: unique symbol = Symbol('top');
export type Before = Id | null | typeof TOP;

/** Siblings in key order, ignoring display pinning, so new keys always fall between neighbours. Ties break by id. */
export async function keyOrdered(tx: Tx, parentId: Id | null, exclude: Set<Id> = new Set()): Promise<ItemRecord[]> {
  return (await tx.children(parentId))
    .filter((r) => r.kind !== undefined && r.purged !== true && !exclude.has(r.id))
    .sort((a, b) => compareSiblings({ id: a.id, order: a.order }, { id: b.id, order: b.order }));
}

/**
 * `n` order keys for new children of `parentId`: before `before`, at the top, or at the end when
 * it is null or gone. Siblings can share a key after two devices insert at the same place, and no
 * key fits between equal keys, so a tied run around the slot is re-keyed with it.
 */
export async function orderKeys(
  tx: Tx,
  parentId: Id | null,
  before: Before,
  n: number,
  exclude: Set<Id> = new Set(),
): Promise<string[]> {
  const siblings = await keyOrdered(tx, parentId, exclude);
  const found = before === TOP ? 0 : before == null ? -1 : siblings.findIndex((s) => s.id === before);
  const idx = found === -1 ? siblings.length : found;
  const key = (i: number) => siblings[i]?.order ?? null;
  let lo = idx;
  let hi = idx;
  if (idx > 0 && idx < siblings.length && key(idx - 1) === key(idx)) {
    while (lo > 0 && key(lo - 1) === key(idx)) lo--;
    while (hi < siblings.length && key(hi) === key(idx)) hi++;
  }
  const keys = generateNKeysBetween(key(lo - 1), key(hi), hi - lo + n);
  const fresh = keys.splice(idx - lo, n);
  for (const [i, rec] of siblings.slice(lo, hi).entries()) await tx.write(rec.id, { order: keys[i]! });
  return fresh;
}

export type SortKey = 'title' | 'created' | 'modified' | 'accessed';

const SORT_COMPARE: Record<SortKey, (a: ItemRecord, b: ItemRecord) => number> = {
  title: (a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }),
  created: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  modified: (a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0),
  accessed: (a, b) => (b.accessedAt ?? -1) - (a.accessedAt ?? -1),
};

/**
 * Sort the groups directly under `parentId`: A-Z, or newest first by date. Folders keep their
 * slots and tabs keep their order. New order keys sync like a manual reorder.
 */
export async function sortGroups(tx: Tx, parentId: Id | null, key: SortKey, reverse: boolean): Promise<void> {
  const siblings = (await keyOrdered(tx, parentId)).filter(isLive);
  const groups = siblings.filter((r) => r.kind === 'group').sort(SORT_COMPARE[key]);
  if (reverse) groups.reverse();
  let next = 0;
  const sorted = siblings.map((r) => (r.kind === 'group' ? groups[next++]! : r));
  const keys = generateNKeysBetween(null, null, sorted.length);
  for (const [i, rec] of sorted.entries()) {
    if (rec.order !== keys[i]) await tx.write(rec.id, { order: keys[i] });
  }
}

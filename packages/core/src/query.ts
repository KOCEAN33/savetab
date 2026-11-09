import { isLive, type Id, type Item } from './model';
import type { ItemSource } from './tx';

interface Sortable {
  id: string;
  order?: string;
  pinnedTop?: boolean;
}

/** Display order: pinned first, then by order key. Ties (concurrent inserts) break by id. */
export function compareSiblings(a: Sortable, b: Sortable): number {
  const pin = Number(b.pinnedTop === true) - Number(a.pinnedTop === true);
  if (pin !== 0) return pin;
  const ao = a.order ?? '';
  const bo = b.order ?? '';
  if (ao !== bo) return ao < bo ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function liveChildren(src: ItemSource, parentId: Id | null): Promise<Item[]> {
  return (await src.children(parentId)).filter(isLive).sort(compareSiblings) as Item[];
}

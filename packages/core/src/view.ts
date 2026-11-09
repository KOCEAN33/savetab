import { linkId, tabTitle } from './link';
import {
  groupDefaults,
  isKind,
  isLive,
  readSettings,
  SETTINGS_ID,
  type Group,
  type Id,
  type Item,
  type ItemRecord,
  type Link,
  type Settings,
  type Tab,
} from './model';
import { compareSiblings } from './query';

const ROOT = '';

/** A read-only snapshot of the whole list, indexed for rendering, export, and search. */
export class ListView {
  readonly settings: Settings;
  /** Trashed items, most recently trashed first. */
  readonly trashed: ItemRecord[] = [];
  private readonly byId = new Map<Id, ItemRecord>();
  private readonly byParent = new Map<Id, Item[]>();
  private readonly counts = new Map<Id, number>();

  constructor(records: ItemRecord[]) {
    for (const rec of records) {
      const r = rec.kind === 'group' ? { ...groupDefaults, ...rec } : rec;
      this.byId.set(r.id, r);
      if (r.trashedAt != null && !r.purged) this.trashed.push(r);
      if (!isLive(r) || r.parentId === undefined) continue;
      if (r.kind !== 'folder' && r.kind !== 'group' && r.kind !== 'tab') continue;
      const key = r.parentId ?? ROOT;
      const list = this.byParent.get(key) ?? [];
      list.push(r as Item);
      this.byParent.set(key, list);
    }
    for (const list of this.byParent.values()) list.sort(compareSiblings);
    this.trashed.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    this.settings = readSettings(this.byId.get(SETTINGS_ID));
  }

  get(id: Id): Item | undefined {
    const r = this.byId.get(id);
    return isLive(r) && (r!.kind === 'folder' || r!.kind === 'group' || r!.kind === 'tab') ? (r as Item) : undefined;
  }

  /** Live items under `parentId` in display order. An empty unnamed group is hidden, as in OneTab. */
  children(parentId: Id | null): Item[] {
    return (this.byParent.get(parentId ?? ROOT) ?? []).filter(
      (i) => i.kind !== 'group' || i.title !== '' || this.tabs(i.id).length > 0,
    );
  }

  tabs(groupId: Id): Tab[] {
    return (this.byParent.get(groupId) ?? []).filter((i): i is Tab => i.kind === 'tab');
  }

  link(tab: Tab): Link | undefined {
    const rec = this.byId.get(linkId(tab.url));
    return isKind(rec, 'link') && rec.purged !== true ? (rec as Link) : undefined;
  }

  /** The title the user sees. Empty means the item shows its default label. */
  title(item: Item): string {
    return item.kind === 'tab' ? tabTitle(item, this.link(item)) : item.title;
  }

  notes(item: Item): string {
    return item.kind === 'tab' ? (this.link(item)?.notes ?? '') : item.notes;
  }

  /** Live tabs anywhere under `id`, or in the whole list for null. */
  tabCount(id: Id | null): number {
    const key = id ?? ROOT;
    const cached = this.counts.get(key);
    if (cached !== undefined) return cached;
    let n = 0;
    for (const child of this.byParent.get(key) ?? []) n += child.kind === 'tab' ? 1 : this.tabCount(child.id);
    this.counts.set(key, n);
    return n;
  }

  /** Every group under `parentId`, depth first in display order. */
  groups(parentId: Id | null): Group[] {
    const out: Group[] = [];
    for (const child of this.children(parentId)) {
      if (child.kind === 'group') out.push(child);
      else if (child.kind === 'folder') out.push(...this.groups(child.id));
    }
    return out;
  }

  /** Every item reachable from the root, depth first in display order. An item under a trashed one is not. */
  private reachable(parentId: Id | null = null): Item[] {
    return this.children(parentId).flatMap((i) => [
      i,
      ...(i.kind === 'folder' ? this.reachable(i.id) : i.kind === 'group' ? this.tabs(i.id) : []),
    ]);
  }

  /** Groups and tabs marked as tasks: pending first, then done, each in display order. */
  tasks(): (Group | Tab)[] {
    const tasks = this.reachable().filter((i): i is Group | Tab => i.kind !== 'folder' && i.task !== 'none');
    return [...tasks.filter((i) => i.task === 'pending'), ...tasks.filter((i) => i.task === 'done')];
  }

  /** Quick list entries in `quickOrder`. Ties from concurrent adds break by id. */
  quickList(): Item[] {
    return this.reachable()
      .filter((i) => i.quickOrder != null)
      .sort((a, b) => compareSiblings({ id: a.id, order: a.quickOrder! }, { id: b.id, order: b.quickOrder! }));
  }

  /** Live ancestors of `id`, outermost first. Stops at a trashed ancestor. */
  path(id: Id): Item[] {
    const out: Item[] = [];
    let parent = this.get(id)?.parentId;
    while (parent != null) {
      const p = this.get(parent);
      if (!p) break;
      out.unshift(p);
      parent = p.parentId;
    }
    return out;
  }
}

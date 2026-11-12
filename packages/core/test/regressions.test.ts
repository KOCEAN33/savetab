import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import {
  copyItems,
  createFolder,
  createWithin,
  editTab,
  emptyTrash,
  importGroups,
  moveItems,
  restoreFromTrash,
  sortGroups,
  storeTabs,
  trashItems,
  updateItem,
  // TOP does not exist yet. Until it lands, this import is undefined at runtime and fails tsc.
  TOP,
} from '../src/index';
import { liveChildren } from '../src/query';
import { ListView } from '../src/view';
import { normalizeUrl } from '../src/link';
import { defaultSettings, isLive, type Settings, type Tab } from '../src/model';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings, id: 'settings', ...patch });
const tab = (n: string) => ({ url: `https://${n}.example/`, title: n.toUpperCase(), favIconUrl: '' });
const store = (s: MemoryStore, names: string[]) =>
  s.transact((tx) => storeTabs(tx, names.map(tab), settings())) as Promise<string>;
const childIds = async (s: MemoryStore, parent: string | null) => (await liveChildren(s, parent)).map((i) => i.id);

async function folderWith(s: MemoryStore, titles: string[]) {
  const f = await s.transact((tx) => createFolder(tx, null, 'F'));
  const groups: string[] = [];
  for (const title of titles) {
    const g = await store(s, [title.toLowerCase()]);
    await s.transact((tx) => updateItem(tx, g, { title }));
    groups.push(g);
  }
  await s.transact((tx) => moveItems(tx, groups, f, null));
  return { f, groups };
}

async function orderOf(s: MemoryStore, id: string) {
  return (await s.get(id))!.order!;
}

describe('import normalizes URLs', () => {
  it('keeps the notes and title of an existing tab after a copy imported without the trailing slash is purged', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) =>
      storeTabs(tx, [{ url: 'https://example.com', title: 'Example', favIconUrl: '' }], settings()),
    ))!;
    const [first] = (await liveChildren(s, g)) as Tab[];
    await s.transact((tx) => editTab(tx, first!.id, { title: 'Mine', notes: 'my notes' }));

    const [imported] = await s.transact((tx) =>
      importGroups(tx, [[{ url: 'https://example.com', title: 'Imported', favIconUrl: '' }]]),
    );
    const [importedTab] = await liveChildren(s, imported!);
    await s.transact((tx) => trashItems(tx, [importedTab!.id]));
    await s.transact((tx) => emptyTrash(tx));

    const v = new ListView(s.all());
    const kept = v.get(first!.id)!;
    expect(v.notes(kept)).toBe('my notes');
    expect(v.title(kept)).toBe('Mine');
  });

  it('stores an imported tab under the normalized URL', async () => {
    const s = new MemoryStore('dev1');
    const [g] = await s.transact((tx) =>
      importGroups(tx, [[{ url: 'https://example.com', title: 'Imported', favIconUrl: '' }]]),
    );
    const [t] = (await liveChildren(s, g!)) as Tab[];
    expect(t!.url).toBe('https://example.com/');
  });

  it('rejects storing a URL already imported in another form when duplicates are rejected', async () => {
    const s = new MemoryStore('dev1');
    await s.transact((tx) => importGroups(tx, [[{ url: 'https://example.com', title: 'Imported', favIconUrl: '' }]]));
    await s.transact((tx) =>
      storeTabs(tx, [{ url: 'https://example.com/', title: 'Example', favIconUrl: '' }], settings({ duplicates: 'reject' })),
    );
    const live = s
      .all()
      .filter((r) => r.kind === 'tab' && isLive(r) && normalizeUrl(r.url!) === 'https://example.com/');
    expect(live).toHaveLength(1);
  });
});

describe('restore with an ancestor in trash', () => {
  async function nested() {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const g = await store(s, ['a']);
    await s.transact((tx) => moveItems(tx, [g], f, null));
    const [t] = await liveChildren(s, g);
    return { s, f, g, t: t!.id };
  }

  it('restores the trashed ancestors too, so the item is reachable and survives emptying the trash', async () => {
    const { s, f, g, t } = await nested();
    await s.transact((tx) => trashItems(tx, [g]));
    await s.transact((tx) => trashItems(tx, [f]));
    await s.transact((tx) => restoreFromTrash(tx, [g]));

    expect(isLive(await s.get(g))).toBe(true);
    let parent = (await s.get(g))!.parentId ?? null;
    while (parent !== null) {
      const rec = await s.get(parent);
      expect(rec, `ancestor ${parent} of the restored group`).toMatchObject({ trashedAt: null, purged: false });
      parent = rec!.parentId ?? null;
    }
    expect(await childIds(s, null)).toContain(f);
    expect(await childIds(s, f)).toContain(g);

    await s.transact((tx) => emptyTrash(tx));
    expect(await s.get(g)).toMatchObject({ trashedAt: null, purged: false });
    expect(await s.get(t)).toMatchObject({ trashedAt: null, purged: false });
    expect(await childIds(s, g)).toEqual([t]);
  });

  it('restores to the root when the ancestor was purged', async () => {
    const { s, f, g } = await nested();
    await s.transact((tx) => trashItems(tx, [g]));
    await s.transact((tx) => trashItems(tx, [f]));
    // emptyTrash purges everything in trash, so the purged-folder-with-trashed-child state is seeded directly.
    await s.transact((tx) => tx.write(f, { purged: true, title: '' }));
    expect(await s.get(g)).toMatchObject({ parentId: f, purged: false });

    await s.transact((tx) => restoreFromTrash(tx, [g]));
    expect(await s.get(g)).toMatchObject({ parentId: null });
    expect(isLive(await s.get(g))).toBe(true);
    expect(await childIds(s, null)).toContain(g);
  });
});

describe('tied order keys', () => {
  it('moves before each sibling without throwing after a sort and a restore', async () => {
    const s = new MemoryStore('dev1');
    const { f, groups } = await folderWith(s, ['A', 'B', 'C']);
    const [, b] = groups;
    await s.transact((tx) => trashItems(tx, [b!]));
    await s.transact((tx) => sortGroups(tx, f, 'title', false));
    await s.transact((tx) => restoreFromTrash(tx, [b!]));

    const before = await childIds(s, f);
    expect(before).toHaveLength(3);
    for (let i = 1; i < before.length; i++) {
      const target = before[i]!;
      const x = await store(s, [`x${i}`]);
      await expect(s.transact((tx) => moveItems(tx, [x], f, target))).resolves.toBeUndefined();
      const now = await childIds(s, f);
      expect(now[now.indexOf(target) - 1]).toBe(x);
    }

    const orders = (await liveChildren(s, f)).map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('moves between two siblings that share an order key after a merge of two devices', async () => {
    const s1 = new MemoryStore('dev1');
    const f = await s1.transact((tx) => createFolder(tx, null, 'F'));
    const existing = await store(s1, ['e']);
    await s1.transact((tx) => moveItems(tx, [existing], f, null));

    const s2 = new MemoryStore('dev2');
    s2.applyRemote(s1.log);
    const fromDev1 = await s1.transact((tx) => createWithin(tx, 'group', f));
    const fromDev2 = await s2.transact((tx) => createWithin(tx, 'group', f));
    s1.applyRemote(s2.log);

    // Setup check: both devices inserted at the top, so the merged keys tie.
    expect(await orderOf(s1, fromDev1)).toBe(await orderOf(s1, fromDev2));

    const [first, second] = await childIds(s1, f);
    const x = await store(s1, ['x']);
    await expect(s1.transact((tx) => moveItems(tx, [x], f, second!))).resolves.toBeUndefined();

    const now = await childIds(s1, f);
    expect(now.slice(0, 3)).toEqual([first, x, second]);
    const keys = [first!, x, second!];
    const orders = await Promise.all(keys.map((id) => orderOf(s1, id)));
    expect(new Set(orders).size).toBe(3);
  });
});

describe('move or copy to the top', () => {
  async function setup() {
    const s = new MemoryStore('dev1');
    const { f, groups } = await folderWith(s, ['U1', 'U2', 'P']);
    const [u1, u2, p] = groups as [string, string, string];
    await s.transact((tx) => updateItem(tx, p, { pinnedTop: true }));
    // Setup check: the pinned group has the highest order key.
    expect(await orderOf(s, p) > (await orderOf(s, u2))).toBe(true);
    expect(await orderOf(s, p) > (await orderOf(s, u1))).toBe(true);
    const x = await store(s, ['x']);
    return { s, f, u1, u2, p, x };
  }

  it('moves an item before every child, pinned ones included', async () => {
    const { s, f, u1, u2, p, x } = await setup();
    await s.transact((tx) => moveItems(tx, [x], f, TOP));
    const xo = await orderOf(s, x);
    expect((await s.get(x))!.parentId).toBe(f);
    for (const id of [u1, u2, p]) expect(xo < (await orderOf(s, id))).toBe(true);
  });

  it('copies an item before every child, pinned ones included', async () => {
    const { s, f, u1, u2, p, x } = await setup();
    const [copy] = await s.transact((tx) => copyItems(tx, [x], f, TOP));
    const co = await orderOf(s, copy!);
    expect((await s.get(copy!))!.parentId).toBe(f);
    for (const id of [u1, u2, p]) expect(co < (await orderOf(s, id))).toBe(true);
  });
});

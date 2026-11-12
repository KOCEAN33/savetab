import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import {
  afterOpen,
  emptyTrash,
  filterStorable,
  importBookmarks,
  importGroups,
  moveItems,
  moveToNewGroup,
  restoreFromTrash,
  storeIntoFirstGroup,
  storeIntoGroup,
  storeTabs,
  trashItems,
  updateItem,
  LockedError,
  CycleError,
  MissingError,
  createFolder,
} from '../src/mutations';
import { liveChildren } from '../src/query';
import { defaultSettings, type Group, type Settings, type Tab } from '../src/model';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings, id: 'settings', ...patch });
const t = (n: string, title = `Title ${n}`) => ({ url: `https://${n}.example/`, title, favIconUrl: '' });

async function urlsOf(store: MemoryStore, groupId: string) {
  return (await liveChildren(store, groupId)).map((x) => (x as Tab).url);
}

async function groupIds(store: MemoryStore) {
  return (await liveChildren(store, null)).map((g) => g.id);
}

describe('storeTabs', () => {
  it('creates one root group holding the tabs in input order', async () => {
    const s = new MemoryStore('dev1');
    const g = await s.transact((tx) => storeTabs(tx, [t('a'), t('b'), t('c')], settings()));
    expect(await groupIds(s)).toEqual([g]);
    expect(await urlsOf(s, g!)).toEqual(['https://a.example/', 'https://b.example/', 'https://c.example/']);
  });

  it('lists a newer group above older ones, but below pinned groups', async () => {
    const s = new MemoryStore('dev1');
    const g1 = await s.transact((tx) => storeTabs(tx, [t('a')], settings()));
    await s.transact((tx) => updateItem(tx, g1!, { pinnedTop: true }));
    const g2 = await s.transact((tx) => storeTabs(tx, [t('b')], settings()));
    const g3 = await s.transact((tx) => storeTabs(tx, [t('c')], settings()));
    expect(await groupIds(s)).toEqual([g1, g3, g2]);
  });

  it('silently rejects URLs already in the list when duplicates are rejected', async () => {
    const s = new MemoryStore('dev1');
    await s.transact((tx) => storeTabs(tx, [t('a')], settings()));
    const g2 = await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings({ duplicates: 'reject' })));
    expect(await urlsOf(s, g2!)).toEqual(['https://b.example/']);

    const g3 = await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings({ duplicates: 'reject' })));
    expect(g3).toBeNull();
    expect(await groupIds(s)).toHaveLength(2);
  });

  it('marks a tab that was pinned in the browser to open pinned', async () => {
    const s = new MemoryStore('dev1');
    const g = await s.transact((tx) => storeTabs(tx, [{ ...t('a'), pinned: true }, t('b')], settings()));
    const tabs = (await liveChildren(s, g!)) as Tab[];
    expect(tabs.map((x) => x.pinOnOpen)).toEqual([true, false]);
  });

  it('splits browser tab groups into their own groups, in window order, with the ungrouped tabs as one plain group', async () => {
    const s = new MemoryStore('dev1');
    const work = { id: 7, title: 'Work', color: 'blue' as const, collapsed: false };
    const read = { id: 9, title: 'Read', color: 'red' as const, collapsed: true };
    const top = await s.transact((tx) =>
      storeTabs(
        tx,
        [
          t('x'),
          { ...t('a1'), browserGroup: work },
          { ...t('a2'), browserGroup: work },
          t('y'),
          { ...t('b1'), browserGroup: { ...read } },
        ],
        settings(),
      ),
    );
    const groups = (await liveChildren(s, null)) as Group[];
    expect(groups[0]!.id).toBe(top);
    expect(groups.map((g) => [g.title, g.openAs])).toEqual([
      ['', undefined],
      ['Work', { mode: 'tabGroup', color: 'blue', collapsed: false }],
      ['Read', { mode: 'tabGroup', color: 'red', collapsed: true }],
    ]);
    expect(await urlsOf(s, groups[0]!.id)).toEqual(['https://x.example/', 'https://y.example/']);
    expect(await urlsOf(s, groups[1]!.id)).toEqual(['https://a1.example/', 'https://a2.example/']);
    expect(await urlsOf(s, groups[2]!.id)).toEqual(['https://b1.example/']);
  });
});

describe('storeIntoFirstGroup', () => {
  it('adds to the first group that is neither pinned nor locked', async () => {
    const s = new MemoryStore('dev1');
    const older = (await s.transact((tx) => storeTabs(tx, [t('a')], settings())))!;
    const locked = (await s.transact((tx) => storeTabs(tx, [t('b')], settings())))!;
    const pinned = (await s.transact((tx) => storeTabs(tx, [t('c')], settings())))!;
    await s.transact((tx) => updateItem(tx, locked, { locked: true }));
    await s.transact((tx) => updateItem(tx, pinned, { pinnedTop: true }));

    const g = await s.transact((tx) => storeIntoFirstGroup(tx, [t('new')], settings()));
    expect(g).toBe(older);
    expect(await urlsOf(s, older)).toContain('https://new.example/');
    expect(await groupIds(s)).toHaveLength(3);
  });

  it('creates a group when no group qualifies', async () => {
    const s = new MemoryStore('dev1');
    const g = await s.transact((tx) => storeIntoFirstGroup(tx, [t('a')], settings()));
    expect(await groupIds(s)).toEqual([g]);
  });
});

describe('storeIntoGroup', () => {
  it('adds tabs to the top of the chosen group', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings())))!;
    await s.transact((tx) => storeTabs(tx, [t('other')], settings()));
    await s.transact((tx) => storeIntoGroup(tx, g, [t('c')], settings()));
    expect(await urlsOf(s, g)).toEqual(['https://c.example/', 'https://a.example/', 'https://b.example/']);
  });

  it('refuses a locked or trashed group', async () => {
    const s = new MemoryStore('dev1');
    const locked = (await s.transact((tx) => storeTabs(tx, [t('a')], settings())))!;
    const gone = (await s.transact((tx) => storeTabs(tx, [t('b')], settings())))!;
    await s.transact((tx) => updateItem(tx, locked, { locked: true }));
    await s.transact((tx) => trashItems(tx, [gone]));
    await expect(s.transact((tx) => storeIntoGroup(tx, locked, [t('c')], settings()))).rejects.toThrow(LockedError);
    await expect(s.transact((tx) => storeIntoGroup(tx, gone, [t('c')], settings()))).rejects.toThrow(MissingError);
  });
});

describe('importGroups', () => {
  it('adds imported groups above existing ones, in the order of the text', async () => {
    const s = new MemoryStore('dev1');
    const old = (await s.transact((tx) => storeTabs(tx, [t('old')], settings())))!;
    const ids = await s.transact((tx) => importGroups(tx, [[t('a'), t('b')], [t('c')]]));
    expect(await groupIds(s)).toEqual([...ids, old]);
    expect(await urlsOf(s, ids[0]!)).toEqual(['https://a.example/', 'https://b.example/']);
    expect(await urlsOf(s, ids[1]!)).toEqual(['https://c.example/']);
  });

  it('puts the groups at the top of a given folder', async () => {
    const s = new MemoryStore('dev1');
    const folder = await s.transact((tx) => createFolder(tx, null, 'F'));
    const [id] = await s.transact((tx) => importGroups(tx, [[t('a')]], folder));
    expect((await liveChildren(s, folder)).map((g) => g.id)).toEqual([id]);
  });
});

describe('importBookmarks', () => {
  it('makes a root folder per bookmark folder, sub-folders inside, and one group for the direct bookmarks', async () => {
    const s = new MemoryStore('dev1');
    const id = await s.transact((tx) =>
      importBookmarks(tx, {
        title: 'Dev',
        links: [t('a'), t('b')],
        folders: [
          { title: 'Go', links: [t('g')], folders: [] },
          { title: 'Empty', links: [], folders: [] },
        ],
      }),
    );
    const root = await liveChildren(s, null);
    expect(root.map((r) => [r.id, r.kind, r.title])).toEqual([[id, 'folder', 'Dev']]);
    const inside = await liveChildren(s, id);
    expect(inside.map((r) => [r.kind, r.title])).toEqual([
      ['folder', 'Go'],
      ['folder', 'Empty'],
      ['group', ''],
    ]);
    expect(await urlsOf(s, inside[2]!.id)).toEqual(['https://a.example/', 'https://b.example/']);
    const go = await liveChildren(s, inside[0]!.id);
    expect(await urlsOf(s, go[0]!.id)).toEqual(['https://g.example/']);
    expect(await liveChildren(s, inside[1]!.id)).toEqual([]);
  });
});

describe('filterStorable', () => {
  const base = { pinned: false };
  it('skips pinned tabs, excluded hosts, and ignored URLs unless sending a single tab', () => {
    const tabs = [
      { ...t('keep'), ...base },
      { ...t('pinned'), pinned: true },
      { ...base, url: 'https://www.excluded.example/page', title: 'x', favIconUrl: '' },
      { ...base, url: 'chrome-extension://self/onetab.html', title: 'savetab', favIconUrl: '' },
    ];
    const s = settings({ excludedDomains: ['www.excluded.example'] });
    const ignore = ['chrome-extension://self/'];
    expect(filterStorable(tabs, s, { single: false, ignorePrefixes: ignore }).map((x) => x.url)).toEqual([
      'https://keep.example/',
    ]);
    expect(
      filterStorable(tabs, settings({ ...s, pinnedTabs: 'allow' }), { single: false, ignorePrefixes: ignore }).map(
        (x) => x.url,
      ),
    ).toEqual(['https://keep.example/', 'https://pinned.example/']);
    expect(filterStorable(tabs.slice(1, 3), s, { single: true, ignorePrefixes: ignore })).toHaveLength(2);
    expect(filterStorable(tabs.slice(3), s, { single: true, ignorePrefixes: ignore })).toHaveLength(0);
  });
});

describe('locks', () => {
  it('refuses to trash a locked group or a tab inside it, and to reorder its tabs', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings())))!;
    await s.transact((tx) => updateItem(tx, g, { locked: true }));
    const [a, b] = await liveChildren(s, g);
    await expect(s.transact((tx) => trashItems(tx, [g]))).rejects.toBeInstanceOf(LockedError);
    await expect(s.transact((tx) => trashItems(tx, [a!.id]))).rejects.toBeInstanceOf(LockedError);
    await expect(s.transact((tx) => moveItems(tx, [b!.id], g, a!.id))).rejects.toBeInstanceOf(LockedError);
    expect(await urlsOf(s, g)).toEqual(['https://a.example/', 'https://b.example/']);
  });
});

describe('afterOpen', () => {
  it('trashes a restored tab, and its unnamed group once empty', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings())))!;
    const [a, b] = await liveChildren(s, g);
    await s.transact((tx) => afterOpen(tx, [a!.id], 'remove'));
    expect(await urlsOf(s, g)).toEqual(['https://b.example/']);
    await s.transact((tx) => afterOpen(tx, [b!.id], 'remove'));
    expect(await groupIds(s)).toEqual([]);
  });

  it('keeps an emptied group that has a name', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a')], settings())))!;
    await s.transact((tx) => updateItem(tx, g, { title: 'Reading' }));
    const [a] = await liveChildren(s, g);
    await s.transact((tx) => afterOpen(tx, [a!.id], 'remove'));
    expect(await groupIds(s)).toEqual([g]);
  });

  it('keeps tabs of a locked group whatever the mode', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a')], settings())))!;
    await s.transact((tx) => updateItem(tx, g, { locked: true }));
    const [a] = await liveChildren(s, g);
    await s.transact((tx) => afterOpen(tx, [a!.id], 'remove'));
    const [after] = await liveChildren(s, g);
    expect(after).toMatchObject({ id: a!.id, trashedAt: null });
  });
});

describe('moveItems', () => {
  it('moves a tab into another group before a given tab', async () => {
    const s = new MemoryStore('dev1');
    const g1 = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings())))!;
    const g2 = (await s.transact((tx) => storeTabs(tx, [t('c'), t('d')], settings())))!;
    const [a] = await liveChildren(s, g1);
    const [, d] = await liveChildren(s, g2);
    await s.transact((tx) => moveItems(tx, [a!.id], g2, d!.id));
    expect(await urlsOf(s, g2)).toEqual(['https://c.example/', 'https://a.example/', 'https://d.example/']);
    expect(await urlsOf(s, g1)).toEqual(['https://b.example/']);
  });

  it('moves tabs into a new group at the top of the list', async () => {
    const s = new MemoryStore('dev1');
    const g1 = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings())))!;
    const [a] = await liveChildren(s, g1);
    const g2 = await s.transact((tx) => moveToNewGroup(tx, [a!.id]));
    expect(await groupIds(s)).toEqual([g2, g1]);
    expect(await urlsOf(s, g2)).toEqual(['https://a.example/']);
  });

  it('refuses to move a folder into itself or a folder inside it', async () => {
    const s = new MemoryStore('dev1');
    const outer = await s.transact((tx) => createFolder(tx, null, 'Outer'));
    const inner = await s.transact((tx) => createFolder(tx, outer, 'Inner'));
    await expect(s.transact((tx) => moveItems(tx, [outer], outer, null))).rejects.toBeInstanceOf(CycleError);
    await expect(s.transact((tx) => moveItems(tx, [outer], inner, null))).rejects.toBeInstanceOf(CycleError);
    expect(await groupIds(s)).toEqual([outer]);
  });

  it('appends to the end when no target sibling is given', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b'), t('c')], settings())))!;
    const [a] = await liveChildren(s, g);
    await s.transact((tx) => moveItems(tx, [a!.id], g, null));
    expect(await urlsOf(s, g)).toEqual(['https://b.example/', 'https://c.example/', 'https://a.example/']);
  });
});

describe('trash', () => {
  it('restores a tab together with its trashed group', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings())))!;
    const [a] = await liveChildren(s, g);
    await s.transact((tx) => trashItems(tx, [g]));
    expect(await groupIds(s)).toEqual([]);
    await s.transact((tx) => restoreFromTrash(tx, [a!.id]));
    expect(await groupIds(s)).toEqual([g]);
    expect(await urlsOf(s, g)).toContain('https://a.example/');
  });

  it('empties trash into tombstones without URLs or titles', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [t('a')], settings())))!;
    const [a] = await liveChildren(s, g);
    await s.transact((tx) => trashItems(tx, [g]));
    await s.transact((tx) => emptyTrash(tx));
    expect(await s.trashed()).toEqual([]);
    expect(await s.get(a!.id)).toMatchObject({ purged: true, url: '', title: '' });
  });
});

describe('sync readiness', () => {
  it('rebuilds the same list on another device from the op log in any order', async () => {
    const s = new MemoryStore('dev1');
    const g1 = (await s.transact((tx) => storeTabs(tx, [t('a'), t('b')], settings())))!;
    const g2 = (await s.transact((tx) => storeTabs(tx, [t('c')], settings())))!;
    const [a] = await liveChildren(s, g1);
    await s.transact((tx) => moveItems(tx, [a!.id], g2, null));
    await s.transact((tx) => updateItem(tx, g2, { title: 'Moved', star: true }));

    const shuffled = [...s.log].reverse();
    const other = new MemoryStore('dev2');
    await other.applyRemote(shuffled);
    expect(await groupIds(other)).toEqual(await groupIds(s));
    for (const g of [g1, g2]) {
      expect(await liveChildren(other, g)).toEqual(await liveChildren(s, g));
    }
  });
});

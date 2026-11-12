import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import {
  copyItems,
  createFolder,
  createWithin,
  editTab,
  mergeGroups,
  LockedError,
  mergeInnerGroups,
  mergeIntoParent,
  MissingError,
  moveItems,
  removeDuplicates,
  storeTabs,
  trashItems,
  updateItem,
} from '../src/mutations';
import { sortGroups } from '../src/order';
import { formatLinks } from '../src/textio';
import { ListView } from '../src/view';
import { defaultSettings, type Tab } from '../src/model';

const settings = { ...defaultSettings, id: 'settings' };
const tab = (n: string) => ({ url: `https://${n}.example/`, title: n.toUpperCase(), favIconUrl: '' });
const store = (s: MemoryStore, names: string[]) =>
  s.transact((tx) => storeTabs(tx, names.map(tab), settings)) as Promise<string>;
const ids = (s: MemoryStore, parent: string | null) => new ListView(s.all()).children(parent).map((i) => i.id);
const names = (s: MemoryStore, group: string) =>
  new ListView(s.all()).tabs(group).map((t: Tab) => new URL(t.url).hostname.split('.')[0]);

describe('createWithin', () => {
  it('places a new group within a folder at its top', async () => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const inner = await s.transact((tx) => createWithin(tx, 'group', f));
    expect(ids(s, f)).toEqual([inner]);
    expect(new ListView(s.all()).get(inner)?.title).toBe('New group');
  });
});

describe('merge', () => {
  it('merges a folder into its parent, keeping its place and order', async () => {
    const s = new MemoryStore('dev1');
    const gB = await store(s, ['b']);
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const g2 = await store(s, ['y']);
    const g1 = await store(s, ['x']);
    await s.transact((tx) => moveItems(tx, [g1, g2], f, null));
    const gA = await store(s, ['a']);

    await s.transact((tx) => mergeIntoParent(tx, f));
    expect(ids(s, null)).toEqual([gA, g1, g2, gB]);
    expect(new ListView(s.all()).get(f)).toBeUndefined();
  });

  it('merges every group under a folder into its first group', async () => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const sub = await s.transact((tx) => createFolder(tx, f, 'Sub'));
    const g2 = await store(s, ['c']);
    await s.transact((tx) => updateItem(tx, g2, { title: 'Named' }));
    const g1 = await store(s, ['a', 'b']);
    await s.transact((tx) => moveItems(tx, [g2], sub, null));
    await s.transact((tx) => moveItems(tx, [g1], f, null));

    await s.transact((tx) => mergeInnerGroups(tx, f));
    // g1 sits below Sub in f, so Sub's group comes first in display order.
    expect(new ListView(s.all()).groups(f).map((g) => g.id)).toEqual([g2]);
    expect(names(s, g2)).toEqual(['c', 'a', 'b']);
  });
});

describe('removeDuplicates', () => {
  it('keeps the first copy of each URL', async () => {
    const s = new MemoryStore('dev1');
    const g = await store(s, ['a', 'b', 'a', 'c', 'b']);
    expect(await s.transact((tx) => removeDuplicates(tx, g))).toBe(2);
    expect(names(s, g)).toEqual(['a', 'b', 'c']);
  });

  it('skips tabs in a locked group', async () => {
    const s = new MemoryStore('dev1');
    const locked = await store(s, ['a', 'a']);
    await s.transact((tx) => updateItem(tx, locked, { locked: true }));
    expect(await s.transact((tx) => removeDuplicates(tx, locked))).toBe(0);
    expect(names(s, locked)).toEqual(['a', 'a']);
  });
});

describe('locked groups inside folders', () => {
  it('refuses to trash a folder holding a locked group', async () => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const g = await store(s, ['a']);
    await s.transact((tx) => moveItems(tx, [g], f, null));
    await s.transact((tx) => updateItem(tx, g, { locked: true }));
    await expect(s.transact((tx) => trashItems(tx, [f]))).rejects.toBeInstanceOf(LockedError);
  });
});

describe('formatLinks', () => {
  const links = [
    { url: 'https://a.example/', title: 'A' },
    { url: 'https://b.example/', title: '' },
  ];

  it('writes each clipboard format, using the URL where a title is missing', () => {
    expect(formatLinks(links, 'urlTitle').text).toBe('https://a.example/ | A\nhttps://b.example/');
    expect(formatLinks(links, 'titleUrl').text).toBe('A https://a.example/\nhttps://b.example/ https://b.example/');
    expect(formatLinks(links, 'url').text).toBe('https://a.example/\nhttps://b.example/');
    expect(formatLinks(links, 'markdown').text).toBe(
      '[A](https://a.example/)\n[https://b.example/](https://b.example/)',
    );
  });

  it('gives rich text as escaped HTML links with a plain-text fallback', () => {
    const out = formatLinks([{ url: 'https://a.example/?x=1&y=2', title: '<A>' }], 'rich');
    expect(out.html).toBe('<a href="https://a.example/?x=1&amp;y=2">&lt;A&gt;</a>');
    expect(out.text).toBe('https://a.example/?x=1&y=2 | <A>');
  });
});

describe('copyItems', () => {
  it('copies a folder with its groups and tabs under new ids, sharing each URL link', async () => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const g = await store(s, ['a', 'b']);
    await s.transact((tx) => moveItems(tx, [g], f, null));
    const dest = await s.transact((tx) => createFolder(tx, null, 'Dest'));

    const [copy] = await s.transact((tx) => copyItems(tx, [f], dest, null));
    const v = new ListView(s.all());
    expect(copy).not.toBe(f);
    expect(v.get(copy!)).toMatchObject({ kind: 'folder', title: 'F', parentId: dest });
    const [copiedGroup] = v.groups(copy!);
    expect(copiedGroup!.id).not.toBe(g);
    expect(names(s, copiedGroup!.id)).toEqual(['a', 'b']);
    expect(names(s, g)).toEqual(['a', 'b']);

    const [orig] = v.tabs(g);
    await s.transact((tx) => editTab(tx, orig!.id, { title: 'Shared' }));
    const after = new ListView(s.all());
    expect(after.title(after.tabs(copiedGroup!.id)[0]!)).toBe('Shared');
  });

  it('copies tabs into a group before a given tab', async () => {
    const s = new MemoryStore('dev1');
    const src = await store(s, ['a']);
    const dest = await store(s, ['x', 'y']);
    const [a] = new ListView(s.all()).tabs(src);
    const [, y] = new ListView(s.all()).tabs(dest);
    await s.transact((tx) => copyItems(tx, [a!.id], dest, y!.id));
    expect(names(s, dest)).toEqual(['x', 'a', 'y']);
    expect(names(s, src)).toEqual(['a']);
  });
});

describe('destinations', () => {
  it('refuses to move or copy into an item that does not exist or is in the trash', async () => {
    const s = new MemoryStore('dev1');
    const g = await store(s, ['a']);
    const gone = await store(s, ['b']);
    await s.transact((tx) => trashItems(tx, [gone]));
    const [a] = new ListView(s.all()).tabs(g);
    await expect(s.transact((tx) => moveItems(tx, [a!.id], 'no-such-id', null))).rejects.toBeInstanceOf(MissingError);
    await expect(s.transact((tx) => moveItems(tx, [a!.id], gone, null))).rejects.toBeInstanceOf(MissingError);
    await expect(s.transact((tx) => copyItems(tx, [a!.id], gone, null))).rejects.toBeInstanceOf(MissingError);
    expect(names(s, g)).toEqual(['a']);
  });
});

describe('mergeGroups', () => {
  it('appends the source tabs to the target and trashes the source, even when named', async () => {
    const s = new MemoryStore('dev1');
    const target = await store(s, ['a']);
    const source = await store(s, ['b', 'c']);
    await s.transact((tx) => updateItem(tx, source, { title: 'Named' }));
    await s.transact((tx) => mergeGroups(tx, source, target));
    expect(names(s, target)).toEqual(['a', 'b', 'c']);
    expect(new ListView(s.all()).get(source)).toBeUndefined();
  });
});

describe('sortGroups', () => {
  async function setup() {
    const s = new MemoryStore('dev1');
    const b = await store(s, ['b']);
    const f = await s.transact((tx) => createFolder(tx, null, 'Folder'));
    const a = await store(s, ['a']);
    const c = await store(s, ['c']);
    await s.transact(async (tx) => {
      // tx.write, not updateItem, which would stamp modifiedAt with the clock.
      await tx.write(b, { title: 'B', createdAt: 1, modifiedAt: 30, accessedAt: null });
      await tx.write(a, { title: 'a', createdAt: 2, modifiedAt: 10, accessedAt: 5 });
      await tx.write(c, { title: 'C', createdAt: 3, modifiedAt: 20, accessedAt: 9 });
    });
    // Root before sorting: c, a, f, b. The folder keeps its slot.
    return { s, a, b, c, f };
  }

  it('sorts groups A-Z ignoring case, leaving folders in their slots', async () => {
    const { s, a, b, c, f } = await setup();
    await s.transact((tx) => sortGroups(tx, null, 'title', false));
    expect(ids(s, null)).toEqual([a, b, f, c]);
    await s.transact((tx) => sortGroups(tx, null, 'title', true));
    expect(ids(s, null)).toEqual([c, b, f, a]);
  });

  it('sorts by recently created, modified, and accessed, newest first', async () => {
    const { s, a, b, c, f } = await setup();
    await s.transact((tx) => sortGroups(tx, null, 'created', false));
    expect(ids(s, null)).toEqual([c, a, f, b]);
    await s.transact((tx) => sortGroups(tx, null, 'modified', false));
    expect(ids(s, null)).toEqual([b, c, f, a]);
    await s.transact((tx) => sortGroups(tx, null, 'accessed', false));
    expect(ids(s, null)).toEqual([c, a, f, b]);
    await s.transact((tx) => sortGroups(tx, null, 'accessed', true));
    expect(ids(s, null)).toEqual([b, a, f, c]);
  });
});

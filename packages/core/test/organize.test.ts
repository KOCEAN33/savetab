import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import {
  createFolder,
  createNear,
  LockedError,
  mergeInnerGroups,
  mergeIntoParent,
  moveItems,
  removeDuplicates,
  storeTabs,
  trashItems,
  updateItem,
} from '../src/mutations';
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

describe('createNear', () => {
  it('places a new group above or below an item, and a group within a folder at its top', async () => {
    const s = new MemoryStore('dev1');
    const g1 = await store(s, ['a']);
    const g2 = await store(s, ['b']);
    const above = await s.transact((tx) => createNear(tx, 'group', g1, 'above'));
    const below = await s.transact((tx) => createNear(tx, 'group', g2, 'below'));
    expect(ids(s, null)).toEqual([g2, below, above, g1]);

    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const inner = await s.transact((tx) => createNear(tx, 'group', f, 'within'));
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
  it('within here: keeps the first copy of each URL', async () => {
    const s = new MemoryStore('dev1');
    const g = await store(s, ['a', 'b', 'a', 'c', 'b']);
    expect(await s.transact((tx) => removeDuplicates(tx, g, 'within'))).toBe(2);
    expect(names(s, g)).toEqual(['a', 'b', 'c']);
  });

  it('here that exist elsewhere: removes copies in here only', async () => {
    const s = new MemoryStore('dev1');
    const other = await store(s, ['a', 'z']);
    const here = await store(s, ['a', 'b']);
    await s.transact((tx) => removeDuplicates(tx, here, 'hereElsewhere'));
    expect(names(s, here)).toEqual(['b']);
    expect(names(s, other)).toEqual(['a', 'z']);
  });

  it('elsewhere that exist here: removes copies outside here only, and skips locked groups', async () => {
    const s = new MemoryStore('dev1');
    const locked = await store(s, ['a']);
    await s.transact((tx) => updateItem(tx, locked, { locked: true }));
    const other = await store(s, ['a', 'z']);
    const here = await store(s, ['a', 'b']);
    await s.transact((tx) => removeDuplicates(tx, here, 'elsewhereHere'));
    expect(names(s, here)).toEqual(['a', 'b']);
    expect(names(s, other)).toEqual(['z']);
    expect(names(s, locked)).toEqual(['a']);
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

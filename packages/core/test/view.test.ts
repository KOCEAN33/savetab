import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import {
  addToQuickList,
  createFolder,
  editTab,
  moveItems,
  removeFromQuickList,
  storeTabs,
  trashItems,
  updateItem,
} from '../src/mutations';
import { ListView } from '../src/view';
import { defaultSettings, type ItemRecord } from '../src/model';

const settings = { ...defaultSettings, id: 'settings' };
const tab = (n: string, title = `T${n}`) => ({ url: `https://${n}.example/`, title, favIconUrl: '' });

async function viewOf(s: MemoryStore): Promise<ListView> {
  return new ListView(s.all());
}

describe('ListView', () => {
  it('lists folders and groups in display order and hides an empty unnamed group', async () => {
    const s = new MemoryStore('dev1');
    const g1 = (await s.transact((tx) => storeTabs(tx, [tab('a')], settings)))!;
    const folder = await s.transact((tx) => createFolder(tx, null, 'Work'));
    const g2 = (await s.transact((tx) => storeTabs(tx, [tab('b')], settings)))!;
    const [b] = (await viewOf(s)).tabs(g2);
    await s.transact((tx) => moveItems(tx, [b!.id], g1, null));
    // moveItems trashes the emptied unnamed group, so revive it as an empty live group.
    await s.transact((tx) => updateItem(tx, g2, { trashedAt: null }));

    const v = await viewOf(s);
    expect(v.children(null).map((i) => i.id)).toEqual([folder, g1]);
  });

  it('shows a tab by its link title, counts tabs through folders, and gives the folder path', async () => {
    const s = new MemoryStore('dev1');
    const outer = await s.transact((tx) => createFolder(tx, null, 'Outer'));
    const inner = await s.transact((tx) => createFolder(tx, outer, 'Inner'));
    const g = (await s.transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings)))!;
    await s.transact((tx) => moveItems(tx, [g], inner, null));
    const [a] = (await viewOf(s)).tabs(g);
    await s.transact((tx) => editTab(tx, a!.id, { title: 'Shown', notes: 'n' }));

    const v = await viewOf(s);
    expect(v.title(v.tabs(g)[0]!)).toBe('Shown');
    expect(v.notes(v.tabs(g)[0]!)).toBe('n');
    expect(v.title(v.tabs(g)[1]!)).toBe('Tb');
    expect(v.tabCount(outer)).toBe(2);
    expect(v.tabCount(null)).toBe(2);
    expect(v.path(g).map((i) => i.id)).toEqual([outer, inner]);
  });

  it('lists pending tasks before done ones, each in display order, skipping trashed ones', async () => {
    const s = new MemoryStore('dev1');
    const gOld = (await s.transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings)))!;
    const gGone = (await s.transact((tx) => storeTabs(tx, [tab('c')], settings)))!;
    const folder = await s.transact((tx) => createFolder(tx, null, 'F'));
    const gNew = (await s.transact((tx) => storeTabs(tx, [tab('d')], settings)))!;
    await s.transact((tx) => moveItems(tx, [gNew], folder, null));
    const [a, b] = (await viewOf(s)).tabs(gOld);
    const [c] = (await viewOf(s)).tabs(gGone);
    await s.transact(async (tx) => {
      await updateItem(tx, a!.id, { task: 'done' });
      await updateItem(tx, b!.id, { task: 'pending' });
      await updateItem(tx, gOld, { task: 'pending' });
      await updateItem(tx, gNew, { task: 'done' });
      await updateItem(tx, c!.id, { task: 'pending' });
    });
    // Root order is folder, gGone, gOld. Trashing gGone leaves its pending tab live but unreachable.
    await s.transact((tx) => trashItems(tx, [gGone]));

    expect((await viewOf(s)).tasks().map((i) => i.id)).toEqual([gOld, b!.id, gNew, a!.id]);
  });

  it('keeps quick list entries in the order added, and removing one leaves the item in the list', async () => {
    const s = new MemoryStore('dev1');
    const g = (await s.transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings)))!;
    const [a, b] = (await viewOf(s)).tabs(g);
    await s.transact((tx) => addToQuickList(tx, b!.id, null));
    await s.transact((tx) => addToQuickList(tx, g, b!.id));
    await s.transact((tx) => addToQuickList(tx, a!.id, g));
    expect((await viewOf(s)).quickList().map((i) => i.id)).toEqual([b!.id, g, a!.id]);

    await s.transact((tx) => removeFromQuickList(tx, g));
    const v = await viewOf(s);
    expect(v.quickList().map((i) => i.id)).toEqual([b!.id, a!.id]);
    expect(v.children(null).map((i) => i.id)).toEqual([g]);
  });

  it('reads a group stored before restore options existed with the default options', () => {
    const old = {
      id: 'g1',
      clocks: {},
      kind: 'group' as const,
      parentId: null,
      order: 'a0',
      title: 'Old',
      trashedAt: null,
      purged: false,
      pinnedTop: false,
      locked: false,
    };
    const g = new ListView([old]).get('g1');
    expect(g).toMatchObject({
      openAs: { mode: 'window', color: 'grey', collapsed: false },
      restoreTarget: 'default',
    });
  });

  it('keeps restore options a group has stored', () => {
    const rec: ItemRecord = {
      id: 'g1',
      clocks: {},
      kind: 'group',
      parentId: null,
      order: 'a0',
      title: 'Set',
      trashedAt: null,
      purged: false,
      openAs: { mode: 'tabGroup', color: 'blue', collapsed: true },
      restoreTarget: 'incognito',
    };
    expect(new ListView([rec]).get('g1')).toMatchObject({
      openAs: { mode: 'tabGroup', color: 'blue', collapsed: true },
      restoreTarget: 'incognito',
    });
  });
});

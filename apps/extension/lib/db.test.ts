import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LockedError, liveChildren, storeTabs, trashItems, updateItem, defaultSettings } from '@savetab/core';
import { db, source, transact } from './db';

const settings = { ...defaultSettings, id: 'settings' };
const tab = (n: string) => ({ url: `https://${n}.example/`, title: n, favIconUrl: '' });

describe('Dexie adapter', () => {
  it('persists a transaction: root group, its tabs, and one outbox row per op', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings)))!;
    expect((await liveChildren(source, null)).map((x) => x.id)).toContain(g);
    expect((await liveChildren(source, g)).map((x) => x.title)).toEqual(['a', 'b']);
    expect(await db.outbox.count()).toBe(3);
  });

  it('rolls back every write when a mutation throws', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('c')], settings)))!;
    await transact((tx) => updateItem(tx, g, { locked: true }));
    const before = await db.outbox.count();
    await expect(
      transact(async (tx) => {
        await updateItem(tx, g, { title: 'renamed' });
        await trashItems(tx, [g]);
      }),
    ).rejects.toBeInstanceOf(LockedError);
    expect(await db.outbox.count()).toBe(before);
    expect((await db.items.get(g))?.title).toBe('');
  });

  it('lists trashed items through the trashedAt index', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('d')], settings)))!;
    await transact((tx) => trashItems(tx, [g]));
    expect((await source.trashed()).map((r) => r.id)).toContain(g);
  });
});

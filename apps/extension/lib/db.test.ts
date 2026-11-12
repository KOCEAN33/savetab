import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  LockedError,
  liveChildren,
  MemoryStore,
  storeTabs,
  trashItems,
  updateItem,
  defaultSettings,
} from '@savetab/core';
import { db, mergePulled, source, syncCursor, transact } from './db';

const settings = { ...defaultSettings, id: 'settings' };
const tab = (n: string) => ({ url: `https://${n}.example/`, title: n, favIconUrl: '' });

describe('Dexie adapter', () => {
  it('persists a transaction: root group, its tabs, their links, and one outbox row per op', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings)))!;
    expect((await liveChildren(source, null)).map((x) => x.id)).toContain(g);
    expect((await liveChildren(source, g)).map((x) => x.title)).toEqual(['a', 'b']);
    expect(await db.outbox.count()).toBe(5);
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

  it('commits 300 writes to one item as one transaction', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('many')], settings)))!;
    const before = await db.outbox.count();
    await transact(async (tx) => {
      for (let i = 1; i <= 300; i++) await updateItem(tx, g, { title: `t${i}` });
    });
    expect((await db.items.get(g))?.title).toBe('t300');
    expect(await db.outbox.count()).toBe(before + 300);
  });

  it('rolls back 300 writes to one item when the mutation then throws', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('undone')], settings)))!;
    const before = await db.outbox.count();
    await expect(
      transact(async (tx) => {
        for (let i = 1; i <= 300; i++) await updateItem(tx, g, { title: `t${i}` });
        throw new RangeError('stop');
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect((await db.items.get(g))?.title).toBe('');
    expect(await db.outbox.count()).toBe(before);
  });

  it('merges a pulled page of 500 ops on one item and moves the cursor with it', async () => {
    const other = new MemoryStore('other');
    const g = (await other.transact((tx) => storeTabs(tx, [tab('pulled')], settings)))!;
    while (other.log.length < 500) await other.transact((tx) => updateItem(tx, g, { title: `n${other.log.length}` }));
    await mergePulled(
      other.log.map((op) => ({ op, receivedAt: Date.now() })),
      500,
    );
    expect((await db.items.get(g))?.title).toBe('n499');
    expect(await syncCursor()).toBe(500);
  });

  it('keeps links out of the root children index', async () => {
    await transact((tx) => storeTabs(tx, [tab('e')], settings));
    expect((await source.children(null)).filter((r) => r.kind === 'link')).toEqual([]);
  });

  it('lists trashed items through the trashedAt index', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('d')], settings)))!;
    await transact((tx) => trashItems(tx, [g]));
    expect((await source.trashed()).map((r) => r.id)).toContain(g);
  });
});

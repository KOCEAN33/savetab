import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { readSettings } from '@savetab/core';

const H0 = '000000000001000-000000-dev1';
const H1 = '000000000002000-000000-dev1';
const H2 = '000000000003000-000000-dev1';
const H3 = '000000000004000-000000-dev1';

async function seedVersion2(): Promise<void> {
  const old = new Dexie('savetab');
  old.version(2).stores({ items: 'id, parentKey, url, trashedAt', outbox: '++seq', meta: 'key' });
  await old.table('items').bulkPut([
    {
      id: 'g1',
      kind: 'group',
      parentId: null,
      parentKey: '',
      title: 'T',
      star: true,
      clocks: { kind: H1, title: H1, star: H2 },
    },
    {
      id: 'settings',
      kind: 'settings',
      urlDisplay: 'full',
      excludedDomains: ['b.example', 'a.example'],
      clocks: { kind: H0, urlDisplay: H0, excludedDomains: H3 },
    },
  ]);
  await old
    .table('outbox')
    .bulkAdd([
      { op: { opId: 'o0', itemId: 'settings', hlc: H0, fields: { kind: 'settings', urlDisplay: 'full' } } },
      { op: { opId: 'o1', itemId: 'g1', hlc: H1, fields: { kind: 'group', title: 'T' } } },
      { op: { opId: 'o2', itemId: 'g1', hlc: H2, fields: { star: true } } },
      { op: { opId: 'o3', itemId: 'settings', hlc: H3, fields: { excludedDomains: ['b.example', 'a.example'] } } },
      { op: { opId: 'o4', itemId: 'gone', hlc: H3, fields: { title: 'x' } } },
    ]);
  old.close();
}

describe('upgrade to database version 3', () => {
  it('gives stored ops a version and a kind, and splits the excluded list into one field per host', async () => {
    await seedVersion2();
    const { db } = await import('./db');
    const ops = (await db.outbox.toArray()).map((row) => row.op);

    expect(ops.find((op) => op.opId === 'o1')).toEqual({
      v: 1,
      opId: 'o1',
      itemId: 'g1',
      kind: 'group',
      hlc: H1,
      fields: { title: 'T' },
    });
    expect(ops.find((op) => op.opId === 'o2')).toEqual({
      v: 1,
      opId: 'o2',
      itemId: 'g1',
      kind: 'group',
      hlc: H2,
      fields: { star: true },
    });
    expect(ops.find((op) => op.opId === 'o3')?.fields).toEqual({});
    expect(ops.some((op) => op.opId === 'o4')).toBe(false);

    const settings = await db.items.get('settings');
    expect(readSettings(settings)).toMatchObject({ excludedDomains: ['a.example', 'b.example'], urlDisplay: 'full' });
    expect(settings).not.toHaveProperty('excludedDomains');
    const split = ops.filter((op) => op.itemId === 'settings' && !['o0', 'o3'].includes(op.opId));
    expect(split).toHaveLength(1);
    expect(split[0]).toMatchObject({
      v: 1,
      kind: 'settings',
      hlc: H3,
      fields: { 'exclude:a.example': true, 'exclude:b.example': true },
    });
  });
});

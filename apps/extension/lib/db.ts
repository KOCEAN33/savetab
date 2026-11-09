import Dexie, { type Table } from 'dexie';
import { Tx, tick, uuidv7, type Hlc, type Id, type ItemRecord, type ItemSource, type Op } from '@savetab/core';

/** IndexedDB does not index null, so root children are indexed under ''. */
type StoredRecord = ItemRecord & { parentKey: string };

class SavetabDb extends Dexie {
  items!: Table<StoredRecord, string>;
  outbox!: Table<{ seq?: number; op: Op }, number>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('savetab');
    this.version(1).stores({
      items: 'id, parentKey, url, trashedAt',
      outbox: '++seq',
      meta: 'key',
    });
  }
}

export const db = new SavetabDb();

export const source: ItemSource = {
  get: (id) => db.items.get(id),
  children: (parentId) =>
    db.items
      .where('parentKey')
      .equals(parentId ?? '')
      .toArray(),
  byUrl: (url) => db.items.where('url').equals(url).toArray(),
  trashed: () =>
    db.items
      .where('trashedAt')
      .above(0)
      .filter((r) => r.purged !== true)
      .toArray(),
};

async function deviceId(): Promise<string> {
  const row = await db.meta.get('deviceId');
  if (typeof row?.value === 'string') return row.value;
  const id = uuidv7();
  await db.meta.put({ key: 'deviceId', value: id });
  return id;
}

/**
 * Run one mutation atomically: items, outbox, and the clock commit together or not at all.
 * The clock lives in the database so the background worker and open pages never reuse a value.
 */
export function transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction('rw', db.items, db.outbox, db.meta, async () => {
    const device = await deviceId();
    let clock = ((await db.meta.get('hlc'))?.value as Hlc | undefined) ?? null;
    const tx = new Tx(source, () => (clock = tick(clock, Date.now(), device)));
    const result = await fn(tx);
    await db.items.bulkPut(tx.changed().map((r) => ({ ...r, parentKey: (r.parentId as Id | null) ?? '' })));
    await db.outbox.bulkAdd(tx.ops.map((op) => ({ op })));
    await db.meta.put({ key: 'hlc', value: clock });
    return result;
  });
}

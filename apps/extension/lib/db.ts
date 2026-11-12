import Dexie, { type Table } from 'dexie';
import {
  applyOp,
  EXCLUDE_PREFIX,
  SETTINGS_ID,
  Tx,
  uuidv7,
  type Hlc,
  type Id,
  type ItemRecord,
  type ItemSource,
  type Op,
} from '@savetab/core';

/**
 * IndexedDB does not index null, so root children are indexed under ''. Records without
 * a parent (links, settings) carry no key and stay out of the index.
 */
type StoredRecord = ItemRecord & { parentKey?: string };

function stored(r: ItemRecord): StoredRecord {
  if (r.parentId === undefined) return r;
  return { ...r, parentKey: (r.parentId as Id | null) ?? '' };
}

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
    this.version(2).upgrade((tx) =>
      tx
        .table<StoredRecord, string>('items')
        .toCollection()
        .modify((r) => {
          if (r.parentId === undefined) delete r.parentKey;
        }),
    );
    // Ops gain a format version and their record's kind, and the excluded hosts move from one
    // array field to one field per host under the array's clock.
    this.version(3).upgrade(async (tx) => {
      const items = tx.table<StoredRecord, string>('items');
      const outbox = tx.table<{ seq?: number; op: Op }, number>('outbox');
      const kinds = new Map((await items.toArray()).map((r) => [r.id, r.kind]));
      await outbox.toCollection().modify((row, ref) => {
        const kind = kinds.get(row.op.itemId);
        if (kind === undefined) {
          delete (ref as { value?: unknown }).value;
          return;
        }
        const { kind: _kind, excludedDomains: _hosts, ...fields } = row.op.fields;
        row.op = { ...row.op, v: 1, kind, fields };
      });
      const settings = await items.get(SETTINGS_ID);
      const hosts = settings?.excludedDomains;
      if (!settings || !Array.isArray(hosts)) return;
      const hlc = settings.clocks.excludedDomains!;
      const { excludedDomains: _hosts, ...rest } = settings;
      const { excludedDomains: _clock, ...clocks } = settings.clocks;
      const op: Op = {
        v: 1,
        opId: uuidv7(),
        itemId: SETTINGS_ID,
        kind: 'settings',
        hlc,
        fields: Object.fromEntries(hosts.map((h) => [EXCLUDE_PREFIX + h, true])),
      };
      await items.put(applyOp({ ...rest, clocks }, op));
      await outbox.add({ op });
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
    const clock = ((await db.meta.get('hlc'))?.value as Hlc | undefined) ?? null;
    const tx = new Tx(source, clock, device);
    const result = await fn(tx);
    await db.items.bulkPut(tx.changed().map(stored));
    await db.outbox.bulkAdd(tx.ops.map((op) => ({ op })));
    await db.meta.put({ key: 'hlc', value: tx.clock });
    return result;
  });
}

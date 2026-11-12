import Dexie, { type Table } from 'dexie';
import {
  applyOp,
  EXCLUDE_PREFIX,
  mergeRecords,
  mergeRemote,
  restoreSnapshot,
  SETTINGS_ID,
  Tx,
  uuidv7,
  type Hlc,
  type Id,
  type ItemRecord,
  type ItemSource,
  type Op,
  type RemoteOp,
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

function sourceOf(items: Table<StoredRecord, string>): ItemSource {
  return {
    get: (id) => items.get(id),
    children: (parentId) =>
      items
        .where('parentKey')
        .equals(parentId ?? '')
        .toArray(),
    byUrl: (url) => items.where('url').equals(url).toArray(),
    trashed: () =>
      items
        .where('trashedAt')
        .above(0)
        .filter((r) => r.purged !== true)
        .toArray(),
  };
}

export const source = sourceOf(db.items);

/**
 * Run one mutation atomically: items, outbox, and the clock commit together or not at all.
 * The clock lives in the database so the background worker and open pages never reuse a value.
 *
 * Every read and write here goes through the transaction's own tables. Dexie finds the current
 * transaction of `db.items` by a zone that it drops after about 100 awaits with no IndexedDB
 * call, and a mutation that writes one record many times awaits that often.
 */
export function transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction('rw', db.items, db.outbox, db.meta, async (trans) => {
    const items = trans.table<StoredRecord, string>('items');
    const meta = trans.table<{ key: string; value: unknown }, string>('meta');
    let device = (await meta.get('deviceId'))?.value as string | undefined;
    if (device === undefined) {
      device = uuidv7();
      await meta.put({ key: 'deviceId', value: device });
    }
    const clock = ((await meta.get('hlc'))?.value as Hlc | undefined) ?? null;
    const tx = new Tx(sourceOf(items), clock, device);
    const result = await fn(tx);
    await items.bulkPut(tx.changed().map(stored));
    await trans.table<{ seq?: number; op: Op }, number>('outbox').bulkAdd(tx.ops.map((op) => ({ op })));
    await meta.put({ key: 'hlc', value: tx.clock });
    return result;
  });
}

/** The sync account this device joined. */
export interface SyncAccount {
  /** The server's base URL, without a trailing slash. */
  serverUrl: string;
  userId: string;
  /** The id the server gave this device at login. Clocks carry the local `deviceId`, not this one. */
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  /** The raw data key. It stays readable because pairing hands it to a new device. */
  dataKey: Uint8Array;
}

export async function syncAccount(): Promise<SyncAccount | undefined> {
  return (await db.meta.get('sync'))?.value as SyncAccount | undefined;
}

/**
 * Join an account. The outbox is replaced by one op per record and clock, so the device uploads
 * what it holds now and not every edit since install.
 */
export function joinSync(account: SyncAccount): Promise<void> {
  return db.transaction('rw', db.items, db.outbox, db.meta, async () => {
    const records = await db.items.toArray();
    await db.outbox.clear();
    await transact((tx) => restoreSnapshot(tx, records));
    await db.meta.bulkPut([
      { key: 'sync', value: account },
      { key: 'syncCursor', value: 0 },
    ]);
    await db.meta.bulkDelete(['syncStatus', 'snapshotSeq']);
  });
}

/** Leave the account. The list stays, and the outbox goes on recording for a later join. */
export async function leaveSync(): Promise<void> {
  await db.meta.bulkDelete(['sync', 'syncCursor', 'syncStatus', 'snapshotSeq']);
}

/** How the last sync cycle ended. `signedOut` means the server refused this device's tokens. */
export interface SyncStatus {
  at: number;
  error?: 'signedOut' | 'failed';
}

export async function syncStatus(): Promise<SyncStatus | undefined> {
  return (await db.meta.get('syncStatus'))?.value as SyncStatus | undefined;
}

/** Record how a cycle ended, unless the device left the account while the cycle ran. */
export function saveSyncStatus(status: SyncStatus): Promise<void> {
  return db.transaction('rw', db.meta, async () => {
    if (await db.meta.get('sync')) await db.meta.put({ key: 'syncStatus', value: status });
  });
}

/** The tokens a refresh returned. The server has already retired the ones they replace. */
export async function saveTokens(tokens: Pick<SyncAccount, 'accessToken' | 'refreshToken'>): Promise<void> {
  await db.meta
    .where('key')
    .equals('sync')
    .modify((row) => {
      Object.assign(row.value as SyncAccount, tokens);
    });
}

/** The `seq` of the last op this device pulled and merged. */
export async function syncCursor(): Promise<number> {
  return ((await db.meta.get('syncCursor'))?.value as number | undefined) ?? 0;
}

/** Merge pulled ops and move the cursor past them in one transaction, so a failed merge is pulled again. */
export function mergePulled(remote: RemoteOp[], cursor: number): Promise<void> {
  return db.transaction('rw', db.items, db.outbox, db.meta, async () => {
    await transact((tx) => mergeRemote(tx, remote));
    await db.meta.put({ key: 'syncCursor', value: cursor });
  });
}

/** The `seq` of the last snapshot this device uploaded or read. */
export async function snapshotSeq(): Promise<number> {
  return ((await db.meta.get('snapshotSeq'))?.value as number | undefined) ?? 0;
}

export async function saveSnapshotSeq(seq: number): Promise<void> {
  await db.meta.put({ key: 'snapshotSeq', value: seq });
}

/** Every record with the cursor it was read at: the content of a snapshot of the log up to `seq`. */
export function snapshotSource(): Promise<{ seq: number; records: ItemRecord[] }> {
  return db.transaction('r', db.items, db.meta, async () => ({
    seq: await syncCursor(),
    records: (await db.items.toArray()).map(({ parentKey: _key, ...record }) => record),
  }));
}

/** Merge a snapshot read from the server and move the cursor to its `seq` in one transaction. */
export function mergeSnapshot(records: ItemRecord[], seq: number): Promise<void> {
  return db.transaction('rw', db.items, db.outbox, db.meta, async () => {
    await transact((tx) => mergeRecords(tx, records));
    await db.meta.bulkPut([
      { key: 'syncCursor', value: seq },
      { key: 'snapshotSeq', value: seq },
    ]);
  });
}

/** The oldest ops waiting for upload. */
export function outboxHead(limit: number): Promise<{ seq?: number; op: Op }[]> {
  return db.outbox.limit(limit).toArray();
}

/** Drop the outbox rows up to `seq`, once the server has stored them. */
export async function dropOutbox(seq: number): Promise<void> {
  await db.outbox.where('seq').belowOrEqual(seq).delete();
}

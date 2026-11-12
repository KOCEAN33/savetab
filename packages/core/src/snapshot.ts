import { uuidv7 } from './id';
import { isSyncField, OP_VERSION, type Hlc, type ItemRecord, type Kind, type Op } from './model';
import { rehomeMerged } from './remote';
import type { Tx } from './tx';

/** A record's syncable fields, grouped by the clock that wrote them. */
function fieldsByClock(rec: ItemRecord, kind: Kind): Map<Hlc, Record<string, unknown>> {
  const byClock = new Map<Hlc, Record<string, unknown>>();
  for (const [field, hlc] of Object.entries(rec.clocks)) {
    if (isSyncField(kind, field)) byClock.set(hlc, { ...byClock.get(hlc), [field]: rec[field] });
  }
  return byClock;
}

/**
 * Write a backup's records back, each field under the clock it had, through the outbox. The
 * restored values merge like the writes they came from, so they lose to newer edits elsewhere.
 */
export async function restoreSnapshot(tx: Tx, records: ItemRecord[]): Promise<void> {
  for (const snap of records) {
    if (snap.kind === undefined) continue;
    for (const [hlc, fields] of fieldsByClock(snap, snap.kind)) await tx.replay(snap.id, snap.kind, hlc, fields);
  }
}

/**
 * Merge the records of a sync snapshot, each field under the clock it had. Nothing is queued for
 * upload, since the server already holds them. Items left under a purged parent are re-homed,
 * as after `mergeRemote`.
 */
export async function mergeRecords(tx: Tx, records: ItemRecord[]): Promise<void> {
  for (const snap of records) {
    if (snap.kind === undefined) continue;
    for (const [hlc, fields] of fieldsByClock(snap, snap.kind)) {
      const op: Op = { v: OP_VERSION, opId: uuidv7(tx.now), itemId: snap.id, kind: snap.kind, hlc, fields };
      await tx.merge(op);
    }
  }
  await rehomeMerged(
    tx,
    records.map((r) => r.id),
  );
}

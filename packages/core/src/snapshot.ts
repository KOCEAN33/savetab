import { isSyncField, type Hlc, type ItemRecord } from './model';
import type { Tx } from './tx';

/**
 * Write a backup's records back, each field under the clock it had, through the outbox. The
 * restored values merge like the writes they came from, so they lose to newer edits elsewhere.
 */
export async function restoreSnapshot(tx: Tx, records: ItemRecord[]): Promise<void> {
  for (const snap of records) {
    if (snap.kind === undefined) continue;
    const byClock = new Map<Hlc, Record<string, unknown>>();
    for (const [field, hlc] of Object.entries(snap.clocks)) {
      if (isSyncField(snap.kind, field)) byClock.set(hlc, { ...byClock.get(hlc), [field]: snap[field] });
    }
    for (const [hlc, fields] of byClock) await tx.replay(snap.id, snap.kind, hlc, fields);
  }
}

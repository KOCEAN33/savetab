import { hlcMs } from './hlc';
import type { Id, Op } from './model';
import { rehome } from './mutations';
import type { Tx } from './tx';

/** How far ahead of the server's receive time an op's clock may run and still be applied. */
export const MAX_SKEW_MS = 5 * 60_000;

export interface RemoteOp {
  op: Op;
  /** When the server received the op, in ms. Every device sees the same value, so all skip the same ops. */
  receivedAt: number;
}

/**
 * Apply ops pulled from the server. An op whose clock runs more than `MAX_SKEW_MS` ahead of its
 * receive time is skipped, or a device with a fast clock would win every field. Then every live
 * item left under a purged parent is re-homed, which writes local ops.
 */
export async function mergeRemote(tx: Tx, remote: RemoteOp[]): Promise<void> {
  const touched = new Set<Id>();
  for (const { op, receivedAt } of remote) {
    if (hlcMs(op.hlc) > receivedAt + MAX_SKEW_MS) continue;
    await tx.merge(op);
    touched.add(op.itemId);
  }
  for (const id of touched) {
    const rec = await tx.get(id);
    if (!rec) continue;
    if (rec.purged === true) for (const child of await tx.children(id)) await rehome(tx, child);
    else await rehome(tx, rec);
  }
}

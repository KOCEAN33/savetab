import { isSyncField, OP_VERSION, type ItemRecord, type Op } from './model';

export class UnsupportedOpError extends Error {
  constructor(v: number) {
    super(`Op format ${v} is newer than this build reads`);
  }
}

/**
 * Per-field last-writer-wins: a field takes the op's value only when the op's clock is newer.
 * Fields outside the kind's syncable list are dropped, and so is an op for a record of another kind.
 */
export function applyOp(rec: ItemRecord, op: Op): ItemRecord {
  if (op.v > OP_VERSION) throw new UnsupportedOpError(op.v);
  if (rec.kind !== undefined && rec.kind !== op.kind) return rec;
  let next: ItemRecord | null = rec.kind === undefined ? { ...rec, kind: op.kind, clocks: { ...rec.clocks } } : null;
  for (const [field, value] of Object.entries(op.fields)) {
    if (!isSyncField(op.kind, field)) continue;
    const clock = rec.clocks[field];
    if (clock !== undefined && clock >= op.hlc) continue;
    next ??= { ...rec, clocks: { ...rec.clocks } };
    next[field] = value;
    next.clocks[field] = op.hlc;
  }
  return next ?? rec;
}

import type { ItemRecord, Op } from './model';

/** Per-field last-writer-wins: a field takes the op's value only when the op's clock is newer. */
export function applyOp(rec: ItemRecord, op: Op): ItemRecord {
  let next: ItemRecord | null = null;
  for (const [field, value] of Object.entries(op.fields)) {
    const clock = rec.clocks[field];
    if (clock !== undefined && clock >= op.hlc) continue;
    next ??= { ...rec, clocks: { ...rec.clocks } };
    next[field] = value;
    next.clocks[field] = op.hlc;
  }
  return next ?? rec;
}

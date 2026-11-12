import { describe, expect, it } from 'vitest';
import { applyOp } from '../src/merge';
import { observe, tick } from '../src/hlc';
import type { ItemRecord, Op } from '../src/model';

describe('hlc', () => {
  it('increases even when the wall clock goes backwards', () => {
    const a = tick(null, 5_000, 'dev1');
    const b = tick(a, 4_000, 'dev1');
    const c = tick(b, 4_000, 'dev1');
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it('orders by wall clock across devices', () => {
    expect(tick(null, 1_000, 'zzz') < tick(null, 2_000, 'aaa')).toBe(true);
  });

  it('ticks past a clock observed from another device', () => {
    const remote = tick(null, 9_000, 'other');
    const local = tick(observe(tick(null, 1_000, 'me'), remote), 1_000, 'me');
    expect(local > remote).toBe(true);
  });
});

const op = (hlc: string, fields: Record<string, unknown>, itemId = 'i1'): Op => ({
  v: 1,
  opId: `${itemId}-${hlc}`,
  itemId,
  kind: 'tab',
  hlc,
  fields,
});

function replay(ops: Op[]): ItemRecord {
  return ops.reduce<ItemRecord>((rec, o) => applyOp(rec, o), { id: 'i1', clocks: {} });
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('applyOp', () => {
  const create = op('0001', { title: 'first', url: 'https://a.example/', star: false });
  const rename = op('0002', { title: 'second' });
  const starAndRename = op('0003', { star: true, title: 'third' });
  const move = op('0004', { parentId: 'g2', order: 'a5' });

  it('converges to the same record for every delivery order', () => {
    const results = permutations([create, rename, starAndRename, move]).map((ops) => replay(ops));
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
    expect(results[0]).toMatchObject({
      kind: 'tab',
      url: 'https://a.example/',
      title: 'third',
      star: true,
      parentId: 'g2',
      order: 'a5',
    });
  });

  it('ignores an older write to a field', () => {
    const rec = replay([starAndRename, rename]);
    expect(rec.title).toBe('third');
  });
});

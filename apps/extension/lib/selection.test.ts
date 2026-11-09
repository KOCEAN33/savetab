import { describe, expect, it } from 'vitest';
import { RESTORE_CAP, restoreCount, selectCommand } from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];
const run = (cmd: Parameters<typeof selectCommand>[0], selected: string[], at = 'c') =>
  [...selectCommand(cmd, order, new Set(selected), at)].sort();

describe('selectCommand', () => {
  it('selects all, none, or the inverse of the current selection', () => {
    expect(run('all', ['a'])).toEqual(order);
    expect(run('none', ['a', 'b'])).toEqual([]);
    expect(run('invert', ['a', 'c'])).toEqual(['b', 'd', 'e']);
  });

  it('selects all except the clicked item', () => {
    expect(run('allExcept', [])).toEqual(['a', 'b', 'd', 'e']);
  });

  it('adds the clicked item and those above or below it to the selection', () => {
    expect(run('thisAndAbove', ['e'])).toEqual(['a', 'b', 'c', 'e']);
    expect(run('thisAndBelow', ['a'])).toEqual(['a', 'c', 'd', 'e']);
  });
});

describe('restoreCount', () => {
  it('opens at most the cap, and asks only above 50 tabs', () => {
    expect(restoreCount(50)).toEqual({ open: 50, confirm: false });
    expect(restoreCount(51)).toEqual({ open: 51, confirm: true });
    expect(restoreCount(800)).toEqual({ open: 500, confirm: true });
    expect(RESTORE_CAP).toBe(500);
  });
});

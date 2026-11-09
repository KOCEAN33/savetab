import type { Id } from '@savetab/core';

/** The commands on a tick's right-click menu, as in OneTab. */
export type SelectCommand = 'all' | 'none' | 'invert' | 'allExcept' | 'thisAndAbove' | 'thisAndBelow';

/** The next selection after `command`, applied to `order` (the visible items, top to bottom) at item `at`. */
export function selectCommand(command: SelectCommand, order: Id[], selected: Set<Id>, at: Id): Set<Id> {
  const i = order.indexOf(at);
  switch (command) {
    case 'all':
      return new Set(order);
    case 'none':
      return new Set();
    case 'invert':
      return new Set(order.filter((id) => !selected.has(id)));
    case 'allExcept':
      return new Set(order.filter((id) => id !== at));
    case 'thisAndAbove':
      return new Set([...selected, ...order.slice(0, i + 1)]);
    case 'thisAndBelow':
      return new Set([...selected, ...order.slice(i)]);
  }
}

/** One open never exceeds this many tabs. */
export const RESTORE_CAP = 500;
/** Opening more tabs than this asks first. */
const CONFIRM_ABOVE = 50;

export function restoreCount(n: number): { open: number; confirm: boolean } {
  return { open: Math.min(n, RESTORE_CAP), confirm: n > CONFIRM_ABOVE };
}

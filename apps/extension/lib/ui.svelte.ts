import { SvelteSet } from 'svelte/reactivity';
import type { Id } from '@savetab/core';
import { transact } from './db';

/** Which row has its title or notes editor open. One editor at a time across the page. */
export const editing = $state<{ title: Id | null; notes: Id | null }>({ title: null, notes: null });

/** Items waiting for a destination in the move or copy dialog. */
export const chooser = $state<{ ids: Id[]; mode: 'move' | 'copy' | null }>({ ids: [], mode: null });

/** Ctrl or Alt held at the drop copies instead of moving, as in OneTab. */
export const keys = $state({ copy: false });

/** Ticked folders, groups, and tabs. */
export const selection = new SvelteSet<Id>();

/** The tick whose right-click menu is open, and where. */
export const selectMenu = $state<{ id: Id | null; x: number; y: number }>({ id: null, x: 0, y: 0 });

/** The row whose action menu is open, and the button it hangs from. One menu for the whole page. */
export const menu = $state<{ id: Id | null; anchor: HTMLElement | null }>({ id: null, anchor: null });

export function toggleMenu(id: Id, anchor: HTMLElement): void {
  Object.assign(menu, menu.id === id ? { id: null, anchor: null } : { id, anchor });
}

/** Run a mutation from a UI event and show its error, such as a locked group refusing a change. */
export function act<T>(fn: Parameters<typeof transact<T>>[0]): Promise<T | undefined> {
  return transact(fn).catch((err) => {
    alert(err instanceof Error ? err.message : String(err));
    return undefined;
  });
}

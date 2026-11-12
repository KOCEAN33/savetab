import { SvelteSet } from 'svelte/reactivity';
import type { TransformDraggedElementFunction } from 'svelte-dnd-action';
import { removeDuplicates, trashItems, type Id, type Item, type ListView } from '@savetab/core';
import { transact } from './db';
import { t } from './i18n';

/** Which row has its title or notes editor open. One editor at a time across the page. */
export const editing = $state<{ title: Id | null; notes: Id | null }>({ title: null, notes: null });

/** Items waiting for a destination in the move or copy dialog. */
export const chooser = $state<{ ids: Id[]; mode: 'move' | 'copy' | null }>({ ids: [], mode: null });

/** Ctrl or Alt held at the drop copies instead of moving, as in OneTab. */
export const keys = $state({ copy: false });

/** Ticked folders, groups, and tabs. */
export const selection = new SvelteSet<Id>();

/** Ticked items in list order, top to bottom through every folder. */
export function ticked(view: ListView): Item[] {
  const out: Item[] = [];
  const walk = (parentId: Id | null) => {
    for (const item of view.children(parentId)) {
      if (selection.has(item.id)) out.push(item);
      if (item.kind === 'folder') walk(item.id);
      else if (item.kind === 'group') for (const tab of view.tabs(item.id)) if (selection.has(tab.id)) out.push(tab);
    }
  };
  walk(null);
  return out;
}

/**
 * The items an action started on the row `id` applies to: every ticked item when `id` is ticked,
 * else `id` alone, as in a file manager. Every row action that can take more than one item,
 * a drop, a menu entry, a delete button, resolves its items here.
 */
export function targets(view: ListView, id: Id): Item[] {
  const item = view.get(id);
  if (!item) return [];
  return selection.has(id) ? ticked(view) : [item];
}

/** Like `targets`, for an action that spends the ticks: they clear once it has its items. */
export function spend(view: ListView, id: Id): Item[] {
  const items = targets(view, id);
  if (selection.has(id)) selection.clear();
  return items;
}

export function trashTargets(view: ListView, id: Id): Promise<void> {
  const ids = spend(view, id).map((i) => i.id);
  return act((tx) => trashItems(tx, ids));
}

/** Trash duplicate tabs under each scope, null for the whole list, and say so when there were none. */
export async function dedupe(scopes: (Id | null)[]): Promise<void> {
  const n = await act(async (tx) => {
    let n = 0;
    for (const scope of scopes) n += await removeDuplicates(tx, scope);
    return n;
  });
  if (n === 0) alert(t('noDuplicates'));
}

/** svelte-dnd-action's `transformDraggedElement`: the dragged row shows how many items the drop moves. */
export function dragCount(view: ListView): TransformDraggedElementFunction {
  return (el, data) => {
    const n = data ? targets(view, data.id as Id).length : 0;
    if (el && n > 1) el.dataset.dragCount = String(n);
  };
}

/** Tabs live in groups, groups and folders in folders, so one move or copy holds only one of the two. */
export function oneShelf(items: Item[]): boolean {
  if (new Set(items.map((i) => i.kind === 'tab')).size <= 1) return true;
  alert(t('moveMixedKinds'));
  return false;
}

/** Open the move or copy dialog for `items`. Returns false when they cannot move together. */
export function choose(items: Item[], mode: 'move' | 'copy'): boolean {
  if (!oneShelf(items)) return false;
  Object.assign(chooser, { ids: items.map((i) => i.id), mode });
  return true;
}

/** The first item after `at` in a drop zone that is not moving, which the moved items land before. */
export function nextStill(items: { id: Id }[], at: number, moving: Id[]): Id | null {
  return items.slice(at + 1).find((i) => !moving.includes(i.id))?.id ?? null;
}

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

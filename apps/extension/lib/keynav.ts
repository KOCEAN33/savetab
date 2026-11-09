import { updateItem, type Id } from '@savetab/core';
import { act } from './ui.svelte';

/** Rows the arrow keys move between: folder and group heads and tab rows, in page order. */
function rows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => el.offsetParent !== null);
}

/**
 * Keyboard navigation inside the list, handled for a focused row only so keys typed into
 * a field or pressed on a button keep their usual meaning. Returns true when it took the key.
 */
export function navigate(e: KeyboardEvent, root: HTMLElement, toParentFolder: () => void): boolean {
  const row = e.target as HTMLElement;
  if (!row.dataset.nav || e.altKey || e.ctrlKey || e.metaKey) return false;
  const all = rows(root);
  const i = all.indexOf(row);
  const id = row.dataset.id as Id;
  switch (e.key) {
    case 'ArrowDown':
      all[i + 1]?.focus();
      return true;
    case 'ArrowUp':
      all[i - 1]?.focus();
      return true;
    case 'Enter':
      if (row.dataset.nav === 'tab') row.querySelector<HTMLElement>('.tab-link')?.click();
      else if (row.dataset.nav === 'group') row.querySelector<HTMLElement>('.restore-all')?.click();
      else row.querySelector<HTMLElement>('.group-label')?.click();
      return true;
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (row.dataset.nav === 'tab') {
        if (e.key === 'ArrowLeft') row.closest('.group')?.querySelector<HTMLElement>('[data-nav="group"]')?.focus();
        return true;
      }
      const collapsed = e.key === 'ArrowLeft';
      void act((tx) => updateItem(tx, id, { collapsed }));
      return true;
    }
    case 'Backspace':
      toParentFolder();
      return true;
    case 'Escape':
      row.blur();
      return true;
  }
  return false;
}

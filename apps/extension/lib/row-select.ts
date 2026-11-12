import type { Id } from '@savetab/core';
import { selection } from './ui.svelte';

/** A press on any of these keeps its own meaning: rows drag, controls click, floating panels stay put. */
const NOT_EMPTY = '[data-nav], a, button, input, select, textarea, label, [role="menu"], [role="toolbar"], dialog, .top-bar';
/** Pixels the pointer moves before a press becomes a rectangle, so a stray click selects nothing. */
const THRESHOLD = 4;

/** The row a plain Ctrl/Cmd-click last ticked or unticked. Shift-click ticks from here. */
let anchor: Id | null = null;

/** Rows of the list, top to bottom, as drawn. */
function rows(list: ParentNode): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('[data-nav][data-id]')];
}

/**
 * Ctrl/Cmd-click toggles a row's tick, Shift-click ticks every row from the last toggled one,
 * as in a file manager. Returns whether the click was a selection, so the caller skips opening.
 */
export function clickSelect(e: MouseEvent, id: Id): boolean {
  if (e.shiftKey && anchor !== null) {
    const ids = rows(document).map((r) => r.dataset.id!);
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)];
    if (a === -1) anchor = null;
    else {
      for (const i of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) selection.add(i);
      return true;
    }
  }
  if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return false;
  if (selection.has(id)) selection.delete(id);
  else selection.add(id);
  anchor = id;
  return true;
}

/**
 * Svelte action on the list: a press on empty page space that drags draws a rectangle, and the
 * rows it touches become the selection.
 */
export function marquee(list: HTMLElement) {
  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest(NOT_EMPTY)) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let box: HTMLElement | null = null;

    function move(e: PointerEvent) {
      const [left, top] = [Math.min(x0, e.clientX), Math.min(y0, e.clientY)];
      const [right, bottom] = [Math.max(x0, e.clientX), Math.max(y0, e.clientY)];
      if (!box) {
        if (right - left < THRESHOLD && bottom - top < THRESHOLD) return;
        box = document.body.appendChild(document.createElement('div'));
        box.className = 'marquee';
        // The press already started a text selection. The rectangle replaces it.
        getSelection()?.removeAllRanges();
        document.body.classList.add('marquee-active');
      }
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      const hit: Id[] = [];
      for (const row of rows(list)) {
        const r = row.getBoundingClientRect();
        if (r.right > left && r.left < right && r.bottom > top && r.top < bottom) hit.push(row.dataset.id!);
      }
      selection.clear();
      for (const id of hit) selection.add(id);
    }

    function up() {
      box?.remove();
      document.body.classList.remove('marquee-active');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    }

    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  addEventListener('pointerdown', down);
  return { destroy: () => removeEventListener('pointerdown', down) };
}

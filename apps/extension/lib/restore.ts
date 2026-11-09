import { browser } from 'wxt/browser';
import { afterOpen, type Settings, type Tab } from '@savetab/core';
import { transact } from './db';

export interface Intent {
  active: boolean;
  newWindow: boolean;
  mode: Settings['afterRestore'];
}

/**
 * OneTab's click modifiers: Cmd/Ctrl (or middle click) keeps the tab listed and inverts
 * "switch to tab", Alt archives it, Shift opens a new window.
 */
export function clickIntent(e: MouseEvent, s: Settings): Intent {
  const mod = e.metaKey || e.ctrlKey || e.button === 1;
  return {
    active: s.switchToRestored !== mod,
    newWindow: e.shiftKey,
    mode: mod ? 'keep' : e.altKey ? 'archive' : s.afterRestore,
  };
}

export const CONFIRM_OPEN_COUNT = 50;

/** Open tabs, then apply the after-restore rule to the ones that opened. */
async function open(tabs: Tab[], intent: Intent, windowId: number | undefined): Promise<void> {
  const opened: string[] = [];
  for (const t of tabs) {
    try {
      await browser.tabs.create({
        url: t.url,
        active: intent.active && opened.length === 0,
        windowId,
        pinned: t.pinOnOpen,
      });
      opened.push(t.id);
    } catch (err) {
      // Browsers refuse some URLs (about:, file:, chrome://) from extensions. Keep those listed.
      console.warn('savetab: could not open', t.url, err);
    }
  }
  if (opened.length > 0) await transact((tx) => afterOpen(tx, opened, intent.mode));
}

export async function restoreTab(tab: Tab, intent: Intent): Promise<void> {
  if (intent.newWindow) {
    const win = await browser.windows.create({ focused: intent.active });
    const blank = win?.tabs?.[0]?.id;
    await open([tab], { ...intent, active: true }, win?.id);
    if (blank !== undefined) await browser.tabs.remove(blank);
    return;
  }
  await open([tab], intent, (await browser.windows.getCurrent()).id);
}

export async function restoreGroup(tabs: Tab[], intent: Intent, s: Settings): Promise<void> {
  if (tabs.length === 0) return;
  if (tabs.length > CONFIRM_OPEN_COUNT && !confirm(`You are about to open ${tabs.length} tabs. Are you sure?`)) return;
  const current = await browser.windows.getCurrent({ populate: true });
  const alone = (current.tabs?.length ?? 0) <= 1;
  const newWindow =
    intent.newWindow || s.restoreGroupTarget === 'new' || (s.restoreGroupTarget === 'newUnlessAlone' && !alone);
  if (!newWindow) {
    await open(tabs, { ...intent, active: false }, current.id);
    return;
  }
  const win = await browser.windows.create({ focused: true });
  const blank = win?.tabs?.[0]?.id;
  await open(tabs, { ...intent, active: true }, win?.id);
  if (blank !== undefined) await browser.tabs.remove(blank);
}

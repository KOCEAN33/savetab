import { browser } from 'wxt/browser';
import { afterOpen, groupDefaults, type GroupFields, type RestoreTarget, type Settings, type Tab } from '@savetab/core';
import { transact } from './db';
import { t } from './i18n';
import { RESTORE_CAP, restoreCount } from './selection';

export interface Intent {
  active: boolean;
  newWindow: boolean;
  mode: Settings['afterRestore'];
}

/**
 * OneTab's click modifiers: Cmd/Ctrl (or middle click) keeps the tab listed and inverts
 * "switch to tab", Shift opens a new window.
 */
export function clickIntent(e: MouseEvent, s: Settings): Intent {
  const mod = e.metaKey || e.ctrlKey || e.button === 1;
  return {
    active: s.switchToRestored !== mod,
    newWindow: e.shiftKey,
    mode: mod ? 'keep' : s.afterRestore,
  };
}

export type RestoreWindow = 'current' | 'new' | 'incognito';

/**
 * Where a group opens: its own menu choice first, then tabGroupRestore for a group that opens
 * as a browser tab group, else restoreGroupTarget. Shift asks for a new window.
 */
export function restoreWindow(
  target: RestoreTarget,
  s: Settings,
  alone: boolean,
  shift: boolean,
  asTabGroup = false,
): RestoreWindow {
  if (target === 'incognito') return 'incognito';
  if (shift || target === 'new') return 'new';
  if (target === 'current') return 'current';
  if (asTabGroup) return s.tabGroupRestore;
  return s.restoreGroupTarget === 'new' || (s.restoreGroupTarget === 'newUnlessAlone' && !alone) ? 'new' : 'current';
}

export function placeholderUrl(url: string): string {
  return `${browser.runtime.getURL('/placeholder.html')}?url=${encodeURIComponent(url)}`;
}

/** How long Chrome waits for a background tab's first URL before leaving it loaded. */
const DISCARD_WAIT_MS = 10_000;

/**
 * Chrome cannot create a tab discarded, and `tabs.discard` before the tab has a URL would
 * lose it. So each tab is discarded once `tabs.onUpdated` reports its first URL.
 */
function chromeDiscarder() {
  const navigated = new Set<number>();
  const waiting = new Map<number, () => void>();
  const listener = (id: number, change: { url?: string }) => {
    if (!change.url) return;
    navigated.add(id);
    waiting.get(id)?.();
  };
  browser.tabs.onUpdated.addListener(listener);
  const jobs: Promise<void>[] = [];
  return {
    add(id: number) {
      const ready = navigated.has(id)
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            waiting.set(id, () => resolve(true));
            setTimeout(() => resolve(false), DISCARD_WAIT_MS);
          });
      jobs.push(
        ready.then(async (ok) => {
          try {
            if (!ok) throw new Error(`no URL after ${DISCARD_WAIT_MS} ms`);
            await browser.tabs.discard(id);
          } catch (err) {
            console.warn('savetab: could not discard tab', id, err);
          }
        }),
      );
    },
    async done() {
      await Promise.all(jobs);
      browser.tabs.onUpdated.removeListener(listener);
    },
  };
}

/**
 * Open tabs, then apply the after-restore rule to the ones that opened their own URL. A URL
 * the browser refuses opens the placeholder page instead, and its tab stays listed.
 * Returns the browser ids of every tab it created.
 */
async function open(tabs: Tab[], intent: Intent, windowId: number | undefined, discard: boolean): Promise<number[]> {
  const opened: string[] = [];
  const created: number[] = [];
  const discarder = discard && !import.meta.env.FIREFOX ? chromeDiscarder() : null;
  for (const [i, t] of tabs.entries()) {
    const active = intent.active && i === 0;
    const unloaded = discard && !active;
    try {
      const tab = await browser.tabs.create({
        url: t.url,
        active,
        windowId,
        pinned: t.pinOnOpen,
        ...(unloaded && import.meta.env.FIREFOX ? { discarded: true, title: t.title || undefined } : {}),
      });
      if (unloaded && tab.id !== undefined) discarder?.add(tab.id);
      if (tab.id !== undefined) created.push(tab.id);
      opened.push(t.id);
    } catch (err) {
      console.warn('savetab: could not open', t.url, err);
      const tab = await browser.tabs.create({ url: placeholderUrl(t.url), active, windowId, pinned: t.pinOnOpen });
      if (tab.id !== undefined) created.push(tab.id);
    }
  }
  await discarder?.done();
  if (opened.length > 0) await transact((tx) => afterOpen(tx, opened, intent.mode));
  return created;
}

/** Gather opened tabs into a browser tab group. A browser without the tab group API leaves them ungrouped. */
async function groupTabs(tabIds: number[], windowId: number | undefined, as: GroupFields['openAs'], title: string) {
  const [first, ...rest] = tabIds;
  if (!browser.tabGroups || first === undefined) return;
  const groupId = await browser.tabs.group({ tabIds: [first, ...rest], createProperties: { windowId } });
  await browser.tabGroups.update(groupId, { title, color: as.color, collapsed: as.collapsed });
}

async function openInNewWindow(
  tabs: Tab[],
  intent: Intent,
  focused: boolean,
  discard: boolean,
): Promise<{ windowId: number | undefined; created: number[] }> {
  const win = await browser.windows.create({ focused });
  const blank = win?.tabs?.[0]?.id;
  const created = await open(tabs, { ...intent, active: true }, win?.id, discard);
  if (blank !== undefined) await browser.tabs.remove(blank);
  return { windowId: win?.id, created };
}

async function openIncognito(tabs: Tab[], intent: Intent): Promise<void> {
  if (!(await browser.extension.isAllowedIncognitoAccess())) {
    alert(t('incognitoNotAllowed'));
    return;
  }
  await browser.windows.create({ incognito: true, url: tabs.map((tab) => tab.url) });
  await transact((tx) =>
    afterOpen(
      tx,
      tabs.map((tab) => tab.id),
      intent.mode,
    ),
  );
}

export async function restoreTab(tab: Tab, intent: Intent): Promise<void> {
  if (intent.newWindow) {
    await openInNewWindow([tab], intent, intent.active, false);
    return;
  }
  await open([tab], intent, (await browser.windows.getCurrent()).id, false);
}

export type GroupRestore = Pick<GroupFields, 'title' | 'restoreTarget' | 'openAs'>;

/**
 * Restore a group's tabs, in the window its `restoreTarget` or the settings pick. A group whose
 * `openAs.mode` is 'tabGroup' opens as a browser tab group with its title and color.
 */
export async function restoreGroup(
  all: Tab[],
  intent: Intent,
  s: Settings,
  group: GroupRestore = { title: '', ...groupDefaults },
): Promise<void> {
  const tabs = all.slice(0, RESTORE_CAP);
  if (tabs.length === 0) return;
  const current = await browser.windows.getCurrent({ populate: true });
  const alone = (current.tabs?.length ?? 0) <= 1;
  const asTabGroup = group.openAs.mode === 'tabGroup';
  const where = restoreWindow(group.restoreTarget, s, alone, intent.newWindow, asTabGroup);
  if (where === 'incognito') return openIncognito(tabs, intent);
  const { windowId, created } =
    where === 'new'
      ? await openInNewWindow(tabs, intent, true, s.discardOnOpen)
      : { windowId: current.id, created: await open(tabs, { ...intent, active: false }, current.id, s.discardOnOpen) };
  if (asTabGroup) await groupTabs(created, windowId, group.openAs, group.title);
}

/** Restore a selection. Above 50 tabs the user confirms first, as in OneTab. */
export async function restoreSelected(tabs: Tab[], intent: Intent, s: Settings): Promise<void> {
  const { open, confirm: ask } = restoreCount(tabs.length);
  if (ask && !confirm(t('confirmOpenTabs', { n: open }))) return;
  await restoreGroup(tabs, intent, s);
}

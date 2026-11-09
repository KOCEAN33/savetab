import { browser, type Browser } from 'wxt/browser';
import {
  filterStorable,
  storeIntoFirstGroup,
  storeIntoGroup,
  storeTabs,
  updateItem,
  type BrowserGroup,
  type Id,
  type NewTab,
  type TabGroupColor,
} from '@savetab/core';
import { transact } from './db';
import { openOneTab } from './onetab-page';
import { touchRecent } from './recent';
import { selectTabs, type SendAction } from './select';
import { getDeviceSettings, getSettings, setSettings } from './settings';

/** Empty pages: OneTab closes them with the rest but does not store them. */
const BLANK_PAGES = [
  'chrome://newtab',
  'chrome://new-tab-page',
  'edge://newtab',
  'about:newtab',
  'about:home',
  'about:blank',
];

/** Pages never stored: savetab itself, which also stays open, and empty pages. */
function ignorePrefixes(): string[] {
  return [browser.runtime.getURL('/'), ...BLANK_PAGES];
}

// Large data: favicons would bloat every synced op. Chrome renders favicons through
// its _favicon endpoint anyway, so only Firefox depends on the stored value.
const MAX_FAVICON_LENGTH = 4096;

function toNewTab(t: Browser.tabs.Tab, groups?: Map<number, BrowserGroup>): NewTab & { pinned: boolean; id?: number } {
  const icon = t.favIconUrl ?? '';
  return {
    id: t.id,
    url: t.url ?? t.pendingUrl ?? '',
    title: t.title ?? '',
    favIconUrl: icon.length <= MAX_FAVICON_LENGTH ? icon : '',
    pinned: t.pinned,
    browserGroup: groups?.get(t.groupId ?? -1) ?? null,
  };
}

/** The browser tab groups `tabs` belong to, by id. Empty where the browser has no tab group API. */
async function browserGroups(tabs: Browser.tabs.Tab[]): Promise<Map<number, BrowserGroup>> {
  const out = new Map<number, BrowserGroup>();
  if (!browser.tabGroups) return out;
  for (const id of new Set(tabs.map((t) => t.groupId ?? -1))) {
    if (id === -1) continue;
    const g = await browser.tabGroups.get(id);
    out.set(id, { id, title: g.title ?? '', color: g.color as TabGroupColor, collapsed: g.collapsed });
  }
  return out;
}

async function focusedWindowId(tab?: Browser.tabs.Tab): Promise<number | undefined> {
  if (tab?.windowId !== undefined && tab.windowId !== browser.windows.WINDOW_ID_NONE) return tab.windowId;
  return (await browser.windows.getLastFocused({ windowTypes: ['normal'] })).id;
}

/** Close the selected open tabs and store them, following OneTab's store rules. */
export async function sendTabs(action: SendAction, origin?: Browser.tabs.Tab): Promise<void> {
  const windowId = await focusedWindowId(origin);
  if (windowId === undefined) return;
  const [windowTabs, allTabs] = await Promise.all([
    browser.tabs.query({ windowId }),
    browser.tabs.query({ windowType: 'normal' }),
  ]);
  const single = action === 'current';
  const selected = selectTabs(action, windowTabs, allTabs);
  // A single-tab send ignores browser tab groups.
  const groups = single ? undefined : await browserGroups(selected);
  const candidates = selected.map((t) => toNewTab(t, groups));
  const settings = await getSettings();
  const storable = filterStorable(candidates, settings, { single, ignorePrefixes: ignorePrefixes() });
  const blanks = single ? [] : candidates.filter((t) => BLANK_PAGES.some((p) => t.url.startsWith(p)));
  if (storable.length === 0) {
    if (!single) await openOneTab(windowId);
    return;
  }

  await transact((tx) => (single ? storeIntoFirstGroup(tx, storable, settings) : storeTabs(tx, storable, settings)));
  // Open the list before closing tabs, so a fully stored window stays open on it.
  if (!single && (await getDeviceSettings()).openAfterStore) await openOneTab(windowId);
  await browser.tabs.remove([...storable, ...blanks].flatMap((t) => (t.id === undefined ? [] : [t.id])));
}

/**
 * The popup's send: the chosen tabs join a new group, named when `title` is set, or an existing
 * group. The tabs were ticked by hand, so the pinned and excluded rules do not apply.
 */
export async function storeChosen(
  tabs: Browser.tabs.Tab[],
  dest: { groupId: Id } | { title: string },
  close: boolean,
): Promise<void> {
  const settings = await getSettings();
  const storable = filterStorable(
    tabs.map((t) => toNewTab(t)),
    settings,
    { single: true, ignorePrefixes: ignorePrefixes() },
  );
  if (storable.length === 0) return;
  if ('groupId' in dest) {
    await transact((tx) => storeIntoGroup(tx, dest.groupId, storable, settings));
    await touchRecent(dest.groupId);
  } else {
    await transact(async (tx) => {
      const id = await storeTabs(tx, storable, settings);
      if (id && dest.title) await updateItem(tx, id, { title: dest.title });
    });
  }
  if (close) await browser.tabs.remove(storable.flatMap((t) => (t.id === undefined ? [] : [t.id])));
}

/** "Send this tab to": the tab joins the top of a chosen group, then closes. It skips the pinned and excluded rules, like "Send only this tab". */
export async function sendTabTo(groupId: Id, tab: Browser.tabs.Tab): Promise<void> {
  const settings = await getSettings();
  const storable = filterStorable([toNewTab(tab)], settings, { single: true, ignorePrefixes: ignorePrefixes() });
  if (storable.length === 0) return;
  await transact((tx) => storeIntoGroup(tx, groupId, storable, settings));
  await touchRecent(groupId);
  if (tab.id !== undefined) await browser.tabs.remove(tab.id);
}

export async function sendLink(url: string, title: string): Promise<void> {
  const settings = await getSettings();
  await transact((tx) => storeIntoFirstGroup(tx, [{ url, title, favIconUrl: '' }], settings));
}

export function hostnameOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

export async function toggleExcluded(host: string): Promise<void> {
  if (!host) return;
  const { excludedDomains } = await getSettings();
  await setSettings({
    excludedDomains: excludedDomains.includes(host)
      ? excludedDomains.filter((d) => d !== host)
      : [...excludedDomains, host],
  });
}

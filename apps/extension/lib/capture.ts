import { browser, type Browser } from 'wxt/browser';
import { filterStorable, storeIntoFirstGroup, storeTabs, type NewTab } from '@savetab/core';
import { transact } from './db';
import { openOneTab } from './onetab-page';
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

function toNewTab(t: Browser.tabs.Tab): NewTab & { pinned: boolean; id?: number } {
  const icon = t.favIconUrl ?? '';
  return {
    id: t.id,
    url: t.url ?? t.pendingUrl ?? '',
    title: t.title ?? '',
    favIconUrl: icon.length <= MAX_FAVICON_LENGTH ? icon : '',
    pinned: t.pinned,
  };
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
  const candidates = selectTabs(action, windowTabs, allTabs).map(toNewTab);
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

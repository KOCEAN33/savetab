import { browser, type Browser } from 'wxt/browser';
import { hostnameOf } from './capture';
import type { SendAction } from './select';
import { getDeviceSettings, getSettings } from './settings';

type ContextType = Browser.contextMenus.CreateProperties['contexts'];

const PAGE: ContextType = ['page', 'frame', 'selection', 'link', 'image', 'video', 'audio', 'editable'];

export const MENU_SEND: Record<string, SendAction> = {
  'send-current': 'current',
  'send-except': 'exceptCurrent',
  'send-left': 'left',
  'send-right': 'right',
  'send-window': 'sendWholeWindow',
  'send-all-windows': 'allWindows',
  'send-tab-group': 'tabGroup',
  'send-selected': 'selected',
};

const SEND_TITLES: Record<keyof typeof MENU_SEND, string> = {
  'send-current': 'Send only this tab to savetab',
  'send-except': 'Send all tabs except this tab to savetab',
  'send-left': 'Send tabs on the left to savetab',
  'send-right': 'Send tabs on the right to savetab',
  'send-window': 'Send all tabs in this window to savetab',
  'send-all-windows': 'Send all tabs from all windows to savetab',
  'send-tab-group': 'Send all tabs in this tab group to savetab',
  'send-selected': 'Send selected tabs to savetab',
};

function create(props: Browser.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve) => {
    browser.contextMenus.create(props, () => {
      // A duplicate id after a racing rebuild is harmless; reading lastError silences the warning.
      void browser.runtime.lastError;
      resolve();
    });
  });
}

export async function rebuildMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  await create({ id: 'display-action', title: 'Display savetab', contexts: ['action'] });
  if (!(await getDeviceSettings()).contextMenu) return;

  await create({ id: 'root', title: 'savetab', contexts: PAGE });
  await create({ id: 'display', parentId: 'root', title: 'Display savetab', contexts: PAGE });
  await create({ id: 'sep-1', parentId: 'root', type: 'separator', contexts: PAGE });
  for (const [id, title] of Object.entries(SEND_TITLES)) {
    await create({ id, parentId: 'root', title, contexts: PAGE });
  }
  await create({ id: 'send-link', parentId: 'root', title: 'Send this web link to savetab', contexts: ['link'] });
  await create({ id: 'sep-2', parentId: 'root', type: 'separator', contexts: PAGE });
  await create({
    id: 'exclude',
    parentId: 'root',
    type: 'checkbox',
    title: 'Exclude this web site from savetab',
    contexts: PAGE,
  });
  await refreshExcludeItem();
}

/** Keep the exclude checkbox's label and state in step with the active tab. */
export async function refreshExcludeItem(): Promise<void> {
  if (!(await getDeviceSettings()).contextMenu) return;
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const host = hostnameOf(tab?.url);
  const { excludedDomains } = await getSettings();
  try {
    await browser.contextMenus.update('exclude', {
      title: host ? `Exclude ${host} from savetab` : 'Exclude this web site from savetab',
      checked: excludedDomains.includes(host),
      enabled: host !== '',
    });
  } catch {
    // The menu is mid-rebuild; rebuildMenus refreshes the item when it finishes.
  }
}

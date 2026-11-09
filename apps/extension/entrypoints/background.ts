import { liveQuery } from 'dexie';
import { browser } from 'wxt/browser';
import { db } from '@/lib/db';
import { hostnameOf, sendLink, sendTabs, toggleExcluded } from '@/lib/capture';
import { MENU_SEND, rebuildMenus, refreshExcludeItem } from '@/lib/menus';
import { omniboxSuggestions } from '@/lib/omnibox';
import { onetabUrl, openOneTab } from '@/lib/onetab-page';
import type { SendAction } from '@/lib/select';
import { deviceSettingsItem, getDeviceSettings } from '@/lib/settings';
import { ListView, SETTINGS_ID } from '@savetab/core';

const COMMAND_SEND: Record<string, SendAction> = {
  'send-current-tab-to-onetab': 'current',
  'send-all-tabs-in-current-window-to-onetab': 'sendWholeWindow',
  'send-all-tabs-in-current-tab-group-to-onetab': 'tabGroup',
  'send-all-tabs-except-this-to-onetab': 'exceptCurrent',
  'send-left-tabs-to-onetab': 'left',
  'send-right-tabs-to-onetab': 'right',
  'send-all-tabs-in-all-windows-to-onetab': 'allWindows',
};

const TOOLBAR_SEND: Record<string, SendAction> = {
  sendWindow: 'sendWindow',
  sendWholeWindow: 'sendWholeWindow',
  sendCurrent: 'current',
};

export default defineBackground(() => {
  // Playwright cannot click the toolbar icon, so e2e builds expose the store entry point.
  if (import.meta.env.MODE === 'e2e') {
    Object.assign(globalThis, { savetabTest: { sendTabs } });
    // WebDriver BiDi cannot navigate to moz-extension:// pages, so give the Firefox smoke test one to drive.
    if (import.meta.env.FIREFOX) {
      browser.runtime.onInstalled.addListener(
        () => void browser.tabs.create({ url: browser.runtime.getURL('/options.html') }),
      );
    }
  }

  browser.action.onClicked.addListener(async (tab) => {
    const { toolbarAction } = await getDeviceSettings();
    await sendTabs(TOOLBAR_SEND[toolbarAction] ?? 'sendWindow', tab);
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command === 'display-onetab') return openOneTab(tab?.windowId);
    const action = COMMAND_SEND[command];
    if (action) await sendTabs(action, tab);
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const id = String(info.menuItemId);
    if (id === 'display' || id === 'display-action') return openOneTab(tab?.windowId);
    if (id === 'send-link' && info.linkUrl) {
      const text = (info as { linkText?: string }).linkText ?? info.selectionText ?? '';
      return sendLink(info.linkUrl, text);
    }
    if (id === 'exclude') return toggleExcluded(hostnameOf(tab?.url ?? info.pageUrl));
    const action = MENU_SEND[id];
    if (action) await sendTabs(action, tab);
  });

  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    suggest(omniboxSuggestions(new ListView(await db.items.toArray()), text, !import.meta.env.FIREFOX));
  });

  // A chosen suggestion arrives as its URL. Other text opens the list with that search.
  browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${onetabUrl()}?q=${encodeURIComponent(text)}`;
    if (disposition === 'currentTab') await browser.tabs.update({ url });
    else await browser.tabs.create({ url, active: disposition === 'newForegroundTab' });
  });

  browser.runtime.onInstalled.addListener(() => void rebuildMenus());
  browser.runtime.onStartup.addListener(async () => {
    await rebuildMenus();
    if ((await getDeviceSettings()).openAtStartup) await openOneTab();
  });
  deviceSettingsItem.watch(() => void rebuildMenus());

  browser.tabs.onActivated.addListener(() => void refreshExcludeItem());
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (change.url) void refreshExcludeItem();
  });
  browser.windows.onFocusChanged.addListener(() => void refreshExcludeItem());
  // liveQuery also sees writes from the OneTab and options pages.
  liveQuery(() => db.items.get(SETTINGS_ID)).subscribe(() => void refreshExcludeItem());
});

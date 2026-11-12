import { liveQuery } from 'dexie';
import { browser, type Browser } from 'wxt/browser';
import { BACKUP_ALARM, BACKUP_PERIOD_MINUTES, restoreIfLost, takeBackup } from '@/lib/backup';
import { db, joinSync, syncAccount } from '@/lib/db';
import { hostnameOf, sendLink, sendTabs, sendTabTo, toggleExcluded } from '@/lib/capture';
import { builtTargets, MENU_SEND, rebuildMenus, refreshExcludeItem, refreshSendTo, SEND_TO_PREFIX } from '@/lib/menus';
import { omniboxSuggestions } from '@/lib/omnibox';
import { onetabUrl, openOneTab } from '@/lib/onetab-page';
import { recentItem } from '@/lib/recent';
import type { SendAction } from '@/lib/select';
import { deviceSettingsItem, getDeviceSettings } from '@/lib/settings';
import { sync, SYNC_ALARM } from '@/lib/sync';
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

/** The toolbar icon opens the send popup with `toolbarAction: 'popup'`. Otherwise its click runs `action.onClicked`. */
async function syncPopup(): Promise<void> {
  const { toolbarAction } = await getDeviceSettings();
  await browser.action.setPopup({ popup: toolbarAction === 'popup' ? 'send.html' : '' });
}

async function onMenuClick(info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab): Promise<void> {
  const id = String(info.menuItemId);
  if (id === 'display' || id === 'display-action') return openOneTab(tab?.windowId);
  if (id === 'send-link' && info.linkUrl) {
    const text = (info as { linkText?: string }).linkText ?? info.selectionText ?? '';
    return sendLink(info.linkUrl, text);
  }
  if (id === 'exclude') return toggleExcluded(hostnameOf(tab?.url ?? info.pageUrl));
  if (id.startsWith(SEND_TO_PREFIX) && tab) return sendTabTo(id.slice(SEND_TO_PREFIX.length), tab);
  const action = MENU_SEND[id];
  if (action) await sendTabs(action, tab);
}

export default defineBackground(() => {
  // Playwright and WebDriver cannot click the toolbar icon or a context menu, so e2e builds expose their handlers.
  if (import.meta.env.MODE === 'e2e') {
    Object.assign(globalThis, {
      savetabTest: { sendTabs, onMenuClick, sendTargets: () => builtTargets, joinSync, sync },
    });
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

  browser.contextMenus.onClicked.addListener(onMenuClick);

  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    suggest(omniboxSuggestions(new ListView(await db.items.toArray()), text, !import.meta.env.FIREFOX));
  });

  // A chosen suggestion arrives as its URL. Other text opens the list with that search.
  browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${onetabUrl()}?q=${encodeURIComponent(text)}`;
    if (disposition === 'currentTab') await browser.tabs.update({ url });
    else await browser.tabs.create({ url, active: disposition === 'newForegroundTab' });
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BACKUP_ALARM) void takeBackup();
    if (alarm.name === SYNC_ALARM) void sync();
  });
  void browser.alarms.get(BACKUP_ALARM).then((alarm) => {
    if (!alarm) void browser.alarms.create(BACKUP_ALARM, { periodInMinutes: BACKUP_PERIOD_MINUTES });
  });
  void restoreIfLost();

  browser.runtime.onInstalled.addListener(() => void rebuildMenus());
  browser.runtime.onStartup.addListener(async () => {
    await rebuildMenus();
    if ((await getDeviceSettings()).openAtStartup) await openOneTab();
  });
  deviceSettingsItem.watch(() => {
    void rebuildMenus();
    void syncPopup();
  });
  void syncPopup();

  browser.tabs.onActivated.addListener(() => void refreshExcludeItem());
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (change.url) void refreshExcludeItem();
  });
  browser.windows.onFocusChanged.addListener(() => void refreshExcludeItem());
  // liveQuery also sees writes from the OneTab and options pages.
  liveQuery(() => db.items.get(SETTINGS_ID)).subscribe(() => void refreshExcludeItem());
  // Ceiling: every write rereads the whole list to rebuild "Send this tab to". Switch to a
  // query over groups if large lists make the background worker busy.
  liveQuery(() => db.items.toArray()).subscribe(() => void refreshSendTo());
  recentItem.watch(() => void refreshSendTo());

  // Ceiling: the server has no channel to this device, and a write from a page does not wake a
  // sleeping worker. The alarm pulls, and pushes such a write, within a minute.
  liveQuery(syncAccount).subscribe((account) => {
    if (!account) return void browser.alarms.clear(SYNC_ALARM);
    void browser.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
    void sync();
  });
  liveQuery(() => db.outbox.count()).subscribe((waiting) => {
    if (waiting > 0) void sync();
  });
});

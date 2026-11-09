import { browser, type Browser } from 'wxt/browser';
import { ListView, type Id } from '@savetab/core';
import { hostnameOf } from './capture';
import { db } from './db';
import { loadLanguage, t, tn } from './i18n';
import { recentItem } from './recent';
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

const SEND_TITLES = {
  'send-current': 'menuSendCurrent',
  'send-except': 'menuSendExcept',
  'send-left': 'menuSendLeft',
  'send-right': 'menuSendRight',
  'send-window': 'menuSendWindow',
  'send-all-windows': 'menuSendAllWindows',
  'send-tab-group': 'menuSendTabGroup',
  'send-selected': 'menuSendSelected',
} as const satisfies Record<keyof typeof MENU_SEND, string>;

export interface SendTarget {
  id: Id;
  title: string;
}

const SEND_TO_RECENT = 5;
const SEND_TO_MAX = 20;
export const SEND_TO_PREFIX = 'send-to:';

/** "Send this tab to" entries: the most recent open groups, then named open groups in list order. Locked groups take no tabs. */
export function sendTargets(view: ListView, recent: Id[]): SendTarget[] {
  const open = view.groups(null).filter((g) => !g.locked);
  const recentGroups = recent.flatMap((id) => open.find((g) => g.id === id) ?? []).slice(0, SEND_TO_RECENT);
  const named = open.filter((g) => g.title !== '' && !recentGroups.includes(g));
  return [...recentGroups, ...named].slice(0, SEND_TO_MAX).map((g) => {
    const n = view.tabs(g.id).length;
    return { id: g.id, title: g.title || tn('tabCount', n) };
  });
}

/** The entries the menu was last built with. */
export let builtTargets: SendTarget[] = [];

async function currentTargets(): Promise<SendTarget[]> {
  return sendTargets(new ListView(await db.items.toArray()), await recentItem.getValue());
}

function create(props: Browser.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve) => {
    browser.contextMenus.create(props, () => {
      // A duplicate id after a racing rebuild is harmless; reading lastError silences the warning.
      void browser.runtime.lastError;
      resolve();
    });
  });
}

let building = Promise.resolve();

/** Rebuilds run one at a time, since an overlapping removeAll would drop the other's items. */
export function rebuildMenus(): Promise<void> {
  building = building.then(build, build);
  return building;
}

/** Rebuild when a "Send this tab to" entry changed, such as a group renamed or a new recent destination. */
export async function refreshSendTo(): Promise<void> {
  if (JSON.stringify(await currentTargets()) !== JSON.stringify(builtTargets)) await rebuildMenus();
}

async function build(): Promise<void> {
  await loadLanguage();
  await browser.contextMenus.removeAll();
  await create({ id: 'display-action', title: t('menuDisplay'), contexts: ['action'] });
  builtTargets = await currentTargets();
  if (!(await getDeviceSettings()).contextMenu) return;

  await create({ id: 'root', title: 'savetab', contexts: PAGE });
  await create({ id: 'display', parentId: 'root', title: t('menuDisplay'), contexts: PAGE });
  await create({ id: 'sep-1', parentId: 'root', type: 'separator', contexts: PAGE });
  for (const [id, key] of Object.entries(SEND_TITLES)) {
    await create({ id, parentId: 'root', title: t(key), contexts: PAGE });
  }
  await create({
    id: 'send-to',
    parentId: 'root',
    title: t('menuSendTo'),
    contexts: PAGE,
    enabled: builtTargets.length > 0,
  });
  for (const t of builtTargets) {
    await create({ id: SEND_TO_PREFIX + t.id, parentId: 'send-to', title: t.title, contexts: PAGE });
  }
  await create({ id: 'send-link', parentId: 'root', title: t('menuSendLink'), contexts: ['link'] });
  await create({ id: 'sep-2', parentId: 'root', type: 'separator', contexts: PAGE });
  await create({
    id: 'exclude',
    parentId: 'root',
    type: 'checkbox',
    title: t('excludeSite'),
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
      title: host ? t('excludeHost', { host }) : t('excludeSite'),
      checked: excludedDomains.includes(host),
      enabled: host !== '',
    });
  } catch {
    // The menu is mid-rebuild; rebuildMenus refreshes the item when it finishes.
  }
}

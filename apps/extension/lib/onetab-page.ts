import { browser, type Browser } from 'wxt/browser';
import { getDeviceSettings } from './settings';

export const ONETAB_PATH = '/onetab.html';

export function onetabUrl(): string {
  return browser.runtime.getURL(ONETAB_PATH);
}

async function findOneTab(): Promise<Browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({});
  return tabs.find((t) => t.url?.startsWith(onetabUrl()));
}

/** Show the OneTab page in `windowId`, reusing an open one per the "Open OneTab" option. */
export async function openOneTab(windowId?: number): Promise<void> {
  const existing = await findOneTab();
  if (!existing?.id) {
    await browser.tabs.create({ url: onetabUrl(), windowId, active: true });
    return;
  }
  const { openOneTabMode } = await getDeviceSettings();
  if (openOneTabMode === 'move' && windowId !== undefined && existing.windowId !== windowId) {
    await browser.tabs.move(existing.id, { windowId, index: -1 });
  }
  await browser.tabs.update(existing.id, { active: true });
  const target = openOneTabMode === 'move' && windowId !== undefined ? windowId : existing.windowId;
  if (target !== undefined) await browser.windows.update(target, { focused: true });
}

import { storage } from 'wxt/utils/storage';
import { readSettings, SETTINGS_ID, type Settings, type SettingsFields } from '@savetab/core';
import { db, transact } from './db';

/** Settings that describe this browser rather than the list. They never sync. */
export interface DeviceSettings {
  toolbarAction: 'sendWindow' | 'sendWholeWindow' | 'sendCurrent';
  openAtStartup: boolean;
  contextMenu: boolean;
  openAfterStore: boolean;
  openOneTabMode: 'switch' | 'move';
}

export const defaultDeviceSettings: DeviceSettings = {
  toolbarAction: 'sendWindow',
  openAtStartup: false,
  contextMenu: true,
  openAfterStore: true,
  openOneTabMode: 'switch',
};

export const deviceSettingsItem = storage.defineItem<Partial<DeviceSettings>>('local:deviceSettings', {
  fallback: {},
});

export async function getDeviceSettings(): Promise<DeviceSettings> {
  return { ...defaultDeviceSettings, ...(await deviceSettingsItem.getValue()) };
}

export async function setDeviceSettings(patch: Partial<DeviceSettings>): Promise<void> {
  await deviceSettingsItem.setValue({ ...(await deviceSettingsItem.getValue()), ...patch });
}

export async function getSettings(): Promise<Settings> {
  return readSettings(await db.items.get(SETTINGS_ID));
}

export function setSettings(patch: Partial<Omit<SettingsFields, 'kind'>>): Promise<void> {
  return transact(async (tx) => {
    await tx.write(SETTINGS_ID, { kind: 'settings', ...patch });
  });
}

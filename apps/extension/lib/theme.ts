import { deviceSettingsItem, getDeviceSettings, type DeviceSettings } from './settings';

export type Theme = DeviceSettings['theme'];

/** `'auto'` leaves `<html>` without `data-theme`, so `tokens.css` follows `prefers-color-scheme`. */
export function applyTheme(theme: Theme): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Apply the device theme to an extension page, and again whenever it changes. */
export async function loadPageTheme(): Promise<void> {
  applyTheme((await getDeviceSettings()).theme);
  deviceSettingsItem.watch((next) => applyTheme(next?.theme ?? 'auto'));
}

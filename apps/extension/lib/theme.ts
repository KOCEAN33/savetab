import { deviceSettingsItem, getDeviceSettings, type DeviceSettings } from './settings';

export type Theme = DeviceSettings['theme'];

/** `'auto'` leaves `<html>` without `data-theme`, so `tokens.css` follows `prefers-color-scheme`. */
export function applyTheme(theme: Theme): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

const CACHE_KEY = 'theme';

function show(theme: Theme): void {
  applyTheme(theme);
  localStorage.setItem(CACHE_KEY, theme);
}

/**
 * Apply the device theme to an extension page, and again whenever it changes. The last theme is
 * kept in localStorage and applied at once, so the page does not flash the other palette.
 */
export async function loadPageTheme(): Promise<void> {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached === 'light' || cached === 'dark') applyTheme(cached);
  show((await getDeviceSettings()).theme);
  deviceSettingsItem.watch((next) => show(next?.theme ?? 'auto'));
}

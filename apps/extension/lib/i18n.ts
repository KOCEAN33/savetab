import { browser } from 'wxt/browser';
import en from '@/locales/en.json';
import ko from '@/locales/ko.json';
import { deviceSettingsItem, getDeviceSettings, type DeviceSettings } from './settings';

export type Lang = 'en' | 'ko';
type Key = keyof typeof en;
/** A count string: the key without its `_one` / `_other` suffix. */
type CountKey = { [K in Key]: K extends `${infer B}_other` ? B : never }[Key];

const MESSAGES: Record<Lang, Partial<Record<Key, string>>> = { en, ko };

let lang: Lang = 'en';

export function resolveLanguage(setting: DeviceSettings['language'], uiLanguage: string): Lang {
  if (setting !== 'auto') return setting;
  return uiLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function setLanguage(next: Lang): void {
  lang = next;
}

/** Read the device language. The browser does not let an extension switch `i18n.getMessage` at runtime, so page text goes through `t`. */
export async function loadLanguage(): Promise<Lang> {
  lang = resolveLanguage((await getDeviceSettings()).language, browser.i18n.getUILanguage());
  return lang;
}

/** Load the language for an extension page, and reload the page when the device language changes. */
export async function loadPageLanguage(): Promise<void> {
  document.documentElement.lang = await loadLanguage();
  deviceSettingsItem.watch((next, prev) => {
    if (next?.language !== prev?.language) location.reload();
  });
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const text = MESSAGES[lang][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** A count string, with `{n}` set to `n` and the plural form picked for the current language. */
export function tn(key: CountKey, n: number, vars: Record<string, string | number> = {}): string {
  const form = new Intl.PluralRules(lang).select(n);
  const full = `${key}_${form}`;
  return t((full in en ? full : `${key}_other`) as Key, { n, ...vars });
}

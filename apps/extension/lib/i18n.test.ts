import { afterEach, describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import ko from '@/locales/ko.json';
import { resolveLanguage, setLanguage, t, tn } from './i18n';

afterEach(() => setLanguage('en'));

describe('locales', () => {
  it('en.json and ko.json have the same keys', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });
});

describe('resolveLanguage', () => {
  it('maps the browser language for auto: ko* to ko, anything else to en', () => {
    expect(resolveLanguage('auto', 'ko')).toBe('ko');
    expect(resolveLanguage('auto', 'ko-KR')).toBe('ko');
    expect(resolveLanguage('auto', 'en-US')).toBe('en');
    expect(resolveLanguage('auto', 'ja')).toBe('en');
  });

  it('keeps an explicit choice over the browser language', () => {
    expect(resolveLanguage('en', 'ko-KR')).toBe('en');
    expect(resolveLanguage('ko', 'en-US')).toBe('ko');
  });
});

describe('t and tn', () => {
  it('fills placeholders and picks the plural form', () => {
    expect(t('excludeHost', { host: 'a.example' })).toBe('Exclude a.example from savetab');
    expect(tn('tabCount', 1)).toBe('1 tab');
    expect(tn('tabCount', 2)).toBe('2 tabs');
    expect(tn('tabCount', 0)).toBe('0 tabs');
  });

  it('reads Korean after setLanguage', () => {
    setLanguage('ko');
    expect(tn('tabCount', 1)).toBe('탭 1개');
    expect(tn('pageTotal', 3)).toBe('전체: 탭 3개');
  });
});

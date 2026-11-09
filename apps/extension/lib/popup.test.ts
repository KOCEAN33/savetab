import { describe, expect, it } from 'vitest';
import { duplicateTabIds, shownTabs, storedTabIds, type PopupFilters } from './popup';

const tab = (id: number, url: string, extra: { pinned?: boolean; groupId?: number } = {}) => ({
  id,
  url,
  title: `T${id}`,
  pinned: false,
  groupId: -1,
  ...extra,
});

const all: PopupFilters = { pinned: true, grouped: true, stored: true, hiddenHosts: new Set() };

describe('shownTabs', () => {
  const tabs = [
    tab(1, 'https://a.example/1', { pinned: true }),
    tab(2, 'https://a.example/2', { groupId: 5 }),
    tab(3, 'https://b.example/'),
    tab(4, 'https://c.example/'),
  ];
  const stored = new Set(['https://c.example/']);

  it('hides pinned tabs, grouped tabs, stored tabs, and hidden hosts, each by its own filter', () => {
    expect(shownTabs(tabs, all, stored).map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(shownTabs(tabs, { ...all, pinned: false }, stored).map((t) => t.id)).toEqual([2, 3, 4]);
    expect(shownTabs(tabs, { ...all, grouped: false }, stored).map((t) => t.id)).toEqual([1, 3, 4]);
    expect(shownTabs(tabs, { ...all, stored: false }, stored).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(shownTabs(tabs, { ...all, hiddenHosts: new Set(['a.example']) }, stored).map((t) => t.id)).toEqual([3, 4]);
  });
});

describe('storedTabIds and duplicateTabIds', () => {
  it('finds open tabs whose normalized URL is listed, and tabs repeating an earlier open tab', () => {
    const tabs = [
      tab(1, 'https://a.example'),
      tab(2, 'https://b.example/'),
      tab(3, 'https://a.example/'),
      tab(4, 'https://b.example/'),
      tab(5, 'https://c.example/'),
    ];
    expect(storedTabIds(tabs, new Set(['https://a.example/']))).toEqual([1, 3]);
    expect(duplicateTabIds(tabs)).toEqual([3, 4]);
  });
});

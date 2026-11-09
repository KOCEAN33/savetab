import { normalizeUrl } from '@savetab/core';
import { hostnameOf } from './capture';

export interface PopupTab {
  id?: number;
  url?: string;
  pinned: boolean;
  groupId?: number;
}

/** The popup's checkboxes. Each true filter includes its tabs. */
export interface PopupFilters {
  pinned: boolean;
  grouped: boolean;
  stored: boolean;
  hiddenHosts: Set<string>;
}

const NO_GROUP = -1;

/** The tabs the popup lists ticked: every tab that no filter hides. */
export function shownTabs<T extends PopupTab>(tabs: T[], f: PopupFilters, storedUrls: Set<string>): T[] {
  return tabs.filter(
    (t) =>
      (f.pinned || !t.pinned) &&
      (f.grouped || (t.groupId ?? NO_GROUP) === NO_GROUP) &&
      (f.stored || !storedUrls.has(normalizeUrl(t.url ?? ''))) &&
      !f.hiddenHosts.has(hostnameOf(t.url)),
  );
}

/** Open tabs whose normalized URL is already listed in savetab. */
export function storedTabIds(tabs: PopupTab[], storedUrls: Set<string>): number[] {
  return tabs.flatMap((t) => (t.id !== undefined && storedUrls.has(normalizeUrl(t.url ?? '')) ? [t.id] : []));
}

/** Open tabs whose normalized URL repeats an earlier open tab. */
export function duplicateTabIds(tabs: PopupTab[]): number[] {
  const seen = new Set<string>();
  return tabs.flatMap((t) => {
    const url = normalizeUrl(t.url ?? '');
    if (!seen.has(url)) {
      seen.add(url);
      return [];
    }
    return t.id === undefined ? [] : [t.id];
  });
}

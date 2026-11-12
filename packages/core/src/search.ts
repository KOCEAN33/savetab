import type { Folder, Group, Id, Item, Tab } from './model';
import type { ListView } from './view';

export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  wholeWords: boolean;
  /** Inclusive bounds on `createdAt`, in ms. */
  createdFrom: number | null;
  createdTo: number | null;
  starred: boolean;
  hasNotes: boolean;
  /** Only named groups and folders, and tabs inside a named group. */
  namedOnly: boolean;
  /** Search only under this folder. null = the whole list. */
  folderId: Id | null;
}

export const emptyQuery: SearchQuery = {
  text: '',
  caseSensitive: false,
  wholeWords: false,
  createdFrom: null,
  createdTo: null,
  starred: false,
  hasNotes: false,
  namedOnly: false,
  folderId: null,
};

export interface SearchResult {
  folders: Folder[];
  /** Each group holding a match. A group that matches itself lists all its tabs. */
  groups: { group: Group; tabs: Tab[] }[];
  /** Matching folders, groups, and tabs. */
  count: number;
}

/** A query that filters nothing shows the plain list instead of results. */
export function isActive(q: SearchQuery): boolean {
  return (
    q.text.trim() !== '' || q.createdFrom !== null || q.createdTo !== null || q.starred || q.hasNotes || q.namedOnly
  );
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every term must appear. A word boundary is any non-letter, non-digit, so Hangul words work too. */
function textMatcher(q: SearchQuery): (haystack: string) => boolean {
  const terms = q.text.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return () => true;
  const flags = q.caseSensitive ? 'u' : 'iu';
  const res = terms.map((t) =>
    q.wholeWords
      ? new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(t)}(?![\\p{L}\\p{N}_])`, flags)
      : new RegExp(escapeRegExp(t), flags),
  );
  return (h) => res.every((re) => re.test(h));
}

export function search(view: ListView, q: SearchQuery): SearchResult {
  const matchText = textMatcher(q);
  const passes = (item: Item, named: boolean): boolean => {
    if (q.createdFrom !== null && item.createdAt < q.createdFrom) return false;
    if (q.createdTo !== null && item.createdAt > q.createdTo) return false;
    if (q.starred && !item.star) return false;
    if (q.hasNotes && view.notes(item) === '') return false;
    if (q.namedOnly && !named) return false;
    const url = item.kind === 'tab' ? item.url : '';
    return matchText(`${view.title(item)}\n${url}\n${view.notes(item)}`);
  };

  const result: SearchResult = { folders: [], groups: [], count: 0 };
  const walk = (parentId: Id | null) => {
    for (const item of view.children(parentId)) {
      if (item.kind === 'folder') {
        if (passes(item, item.title !== '')) {
          result.folders.push(item);
          result.count++;
        }
        walk(item.id);
      } else if (item.kind === 'group') {
        const all = view.tabs(item.id);
        if (passes(item, item.title !== '')) {
          result.groups.push({ group: item, tabs: all });
          result.count++;
          continue;
        }
        const tabs = all.filter((t) => passes(t, item.title !== ''));
        if (tabs.length > 0) result.groups.push({ group: item, tabs });
        result.count += tabs.length;
      }
    }
  };
  walk(q.folderId);
  return result;
}

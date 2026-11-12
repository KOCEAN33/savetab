import type { CopyFormat, Id, Item } from './model';
import type { ListView } from './view';

export interface LinkLine {
  url: string;
  title: string;
}

const SEPARATOR = ' | ';
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** URL is the first whitespace-free run, so a `|` inside a URL stays part of it. */
const LINE = /^(\S+)(?:\s+\|(.*))?$/;

/** OneTab's export format: `URL | Title` per line, a blank line between groups. */
export function exportText(groups: LinkLine[][]): string {
  return groups
    .filter((tabs) => tabs.length > 0)
    .map((tabs) => tabs.map((t) => (t.title ? `${t.url}${SEPARATOR}${t.title}` : t.url)).join('\n') + '\n')
    .join('\n');
}

/** Inverse of exportText. Lines without a URL scheme are skipped, as OneTab requires one. */
export function parseImportText(text: string): LinkLine[][] {
  const groups: LinkLine[][] = [];
  let current: LinkLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    const m = LINE.exec(line);
    if (m && HAS_SCHEME.test(m[1]!)) current.push({ url: m[1]!, title: (m[2] ?? '').trim() });
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Clipboard text for "Copy links". Rich text carries HTML links plus the `URL | Title` text as fallback. */
export function formatLinks(links: LinkLine[], format: CopyFormat): { text: string; html?: string } {
  const line = (l: LinkLine): string => {
    const title = l.title || l.url;
    switch (format) {
      case 'titleUrl':
        return `${title} ${l.url}`;
      case 'url':
        return l.url;
      case 'markdown':
        return `[${title}](${l.url})`;
      default:
        return l.title ? `${l.url}${SEPARATOR}${l.title}` : l.url;
    }
  };
  const text = links.map(line).join('\n');
  if (format !== 'rich') return { text };
  const html = links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.title || l.url)}</a>`).join('<br>');
  return { text, html };
}

const PAGE_STYLE =
  'font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#444;max-width:960px;margin:32px auto;padding:0 20px';
const LIST_STYLE = 'list-style:none;padding:0;margin:0 0 20px';
const NOTE_STYLE = 'margin:0 0 4px;color:#767676;white-space:pre-wrap';

type TabCount = (n: number) => string;
const englishTabCount: TabCount = (n) => `${n} ${n === 1 ? 'tab' : 'tabs'}`;

/** The title an exported folder or group carries: its own, or the default label the list shows. */
function exportLabel(view: ListView, item: Item, tabCount: TabCount): string {
  return item.kind === 'group' ? item.title || tabCount(view.tabs(item.id).length) : item.title || 'savetab';
}

/**
 * One standalone HTML page for a folder or group: its title as `<h1>`, each group a heading with
 * its tabs as links, notes as text under their item, sub-folders one heading level deeper.
 * Inline styles only, so the file renders the same anywhere.
 */
export function exportHtml(
  view: ListView,
  id: Id,
  tabCount: TabCount = englishTabCount,
): string {
  const root = view.get(id);
  if (!root) return '';
  const label = (item: Item) => exportLabel(view, item, tabCount);
  const notes = (item: Item): string => {
    const text = view.notes(item);
    return text ? `<p style="${NOTE_STYLE}">${escapeHtml(text)}</p>` : '';
  };
  const tabs = (groupId: Id): string =>
    `<ul style="${LIST_STYLE}">` +
    view
      .tabs(groupId)
      .map((t) => `<li><a href="${escapeHtml(t.url)}">${escapeHtml(view.title(t) || t.url)}</a>${notes(t)}</li>`)
      .join('') +
    '</ul>';
  const heading = (level: number, item: Item) => {
    const h = Math.min(level, 6);
    return `<h${h}>${escapeHtml(label(item))}</h${h}>${notes(item)}`;
  };
  const body = (item: Item, level: number): string => {
    if (item.kind === 'group') return heading(level, item) + tabs(item.id);
    if (item.kind !== 'folder') return '';
    return (
      heading(level, item) +
      view
        .children(item.id)
        .map((child) => body(child, level + 1))
        .join('')
    );
  };
  const title = escapeHtml(label(root));
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title></head><body style="${PAGE_STYLE}">${body(root, 1)}</body></html>\n`;
}

export interface SharedTab {
  url: string;
  /** Empty = the page shows the URL. */
  title: string;
  notes: string;
}

export type SharedItem =
  | { kind: 'group'; title: string; notes: string; tabs: SharedTab[] }
  | { kind: 'folder'; title: string; notes: string; items: SharedItem[] };

/** The plaintext of a shared web page (plan P4, "Share blob"). */
export interface ShareContent {
  v: 1;
  title: string;
  notes: string;
  items: SharedItem[];
}

/** A copy of a folder or group for a shared web page. A group becomes a root that holds that one group. */
export function shareContent(view: ListView, id: Id, tabCount: TabCount = englishTabCount): ShareContent | undefined {
  const root = view.get(id);
  if (!root || root.kind === 'tab') return undefined;
  const copy = (item: Item): SharedItem[] => {
    const head = { title: exportLabel(view, item, tabCount), notes: item.notes };
    if (item.kind === 'group') {
      const tabs = view.tabs(item.id).map((t) => ({ url: t.url, title: view.title(t), notes: view.notes(t) }));
      return [{ kind: 'group', ...head, tabs }];
    }
    if (item.kind !== 'folder') return [];
    return [{ kind: 'folder', ...head, items: view.children(item.id).flatMap(copy) }];
  };
  const title = exportLabel(view, root, tabCount);
  if (root.kind === 'group') return { v: 1, title, notes: '', items: copy(root) };
  return { v: 1, title, notes: root.notes, items: view.children(root.id).flatMap(copy) };
}

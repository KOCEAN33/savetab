import type { CopyFormat } from './model';

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

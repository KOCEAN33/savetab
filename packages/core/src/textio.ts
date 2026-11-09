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

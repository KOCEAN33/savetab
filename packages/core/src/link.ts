import { isKind, type Link, type Tab } from './model';
import type { ItemSource } from './tx';

// Engines agree on how these schemes serialize. For any other scheme they differ: Chromium
// turns chrome://crash into chrome://crash/, Node and Firefox do not.
const SPECIAL_SCHEME = /^\s*(https?|ftp|wss?|file):/i;

/**
 * The URL form copies are compared by, the same on every engine. A URL of another scheme, or a
 * string the URL parser rejects, stays as given.
 */
export function normalizeUrl(raw: string): string {
  if (!SPECIAL_SCHEME.test(raw)) return raw;
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

/** cyrb53, a 53-bit non-cryptographic string hash. */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Every device derives the same id from a URL, so links stored concurrently merge.
 * Synchronous on purpose: a Dexie transaction commits at any await outside IndexedDB,
 * which rules out crypto.subtle.
 */
export function linkId(url: string): string {
  const u = normalizeUrl(url);
  return `link-${cyrb53(u, 1).toString(16).padStart(14, '0')}${cyrb53(u, 2).toString(16).padStart(14, '0')}`;
}

export async function linkOf(src: ItemSource, url: string): Promise<Link | undefined> {
  const rec = await src.get(linkId(url));
  return isKind(rec, 'link') && rec.purged !== true ? (rec as Link) : undefined;
}

/** A tab stored before its URL had a link keeps its own title until the link exists. */
export function tabTitle(tab: Pick<Tab, 'title'>, link: Pick<Link, 'title'> | undefined): string {
  return link ? link.title : tab.title;
}

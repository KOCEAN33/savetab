import { parseImportText, type LinkLine } from '@savetab/core';

const SCHEMES = ['http:', 'https:', 'ftp:'];

/** Links from `<a>` elements: absolute http, https, and ftp hrefs, with the link text as the title. */
export function anchorLinks(anchors: { href: string; text: string }[]): LinkLine[] {
  return anchors.flatMap(({ href, text }) => {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return [];
    }
    return SCHEMES.includes(url.protocol) ? [{ url: href, title: text.replace(/\s+/g, ' ').trim() }] : [];
  });
}

export function linksFromHtml(html: string): LinkLine[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return anchorLinks(
    [...doc.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href')!, text: a.textContent ?? '' })),
  );
}

/** `text/uri-list` or plain text. Comment lines in a uri-list have no URL scheme, so they drop out. */
export function linksFromText(text: string): LinkLine[] {
  return parseImportText(text).flat();
}

/** The links a paste or drop carries: its HTML links, else its uri-list, else its text. */
export function linksFromData(data: DataTransfer): LinkLine[] {
  const html = data.getData('text/html');
  if (html) return linksFromHtml(html);
  return linksFromText(data.getData('text/uri-list') || data.getData('text/plain'));
}

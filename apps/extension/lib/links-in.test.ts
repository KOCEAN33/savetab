import { describe, expect, it } from 'vitest';
import { anchorLinks, linksFromText } from './links-in';

describe('anchorLinks', () => {
  it('keeps http, https, and ftp links with their collapsed text as the title', () => {
    expect(
      anchorLinks([
        { href: 'https://a.example/', text: '  A \n  link ' },
        { href: 'javascript:alert(1)', text: 'bad' },
        { href: '/relative', text: 'relative' },
        { href: 'mailto:x@example.com', text: 'mail' },
        { href: 'ftp://f.example/x', text: '' },
        { href: 'http://b.example/', text: 'B' },
      ]),
    ).toEqual([
      { url: 'https://a.example/', title: 'A link' },
      { url: 'ftp://f.example/x', title: '' },
      { url: 'http://b.example/', title: 'B' },
    ]);
  });
});

describe('linksFromText', () => {
  it('reads a text/uri-list, skipping its comment lines', () => {
    expect(linksFromText('# from a browser\r\nhttps://a.example/\r\nhttps://b.example/x\r\n')).toEqual([
      { url: 'https://a.example/', title: '' },
      { url: 'https://b.example/x', title: '' },
    ]);
  });

  it('reads plain "URL | Title" lines across blank lines as one list', () => {
    expect(linksFromText('https://a.example/ | A\n\nhttps://b.example/ | B')).toEqual([
      { url: 'https://a.example/', title: 'A' },
      { url: 'https://b.example/', title: 'B' },
    ]);
  });
});

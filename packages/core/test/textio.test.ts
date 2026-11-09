import { describe, expect, it } from 'vitest';
import { exportText, parseImportText } from '../src/textio';

describe('exportText', () => {
  it('writes one "URL | Title" line per tab and a blank line between groups', () => {
    const text = exportText([
      [
        { url: 'https://a.example/', title: 'A page' },
        { url: 'https://b.example/x?y=1', title: '' },
      ],
      [{ url: 'https://c.example/', title: 'C | with pipe' }],
    ]);
    expect(text).toBe(
      'https://a.example/ | A page\n' + 'https://b.example/x?y=1\n' + '\n' + 'https://c.example/ | C | with pipe\n',
    );
  });
});

describe('parseImportText', () => {
  it('splits groups on blank lines and titles on the first " | "', () => {
    const groups = parseImportText(
      'https://a.example/ | A page\n' + 'https://b.example/\n' + '\n\n\n' + 'https://c.example/ | C | with pipe\n',
    );
    expect(groups).toEqual([
      [
        { url: 'https://a.example/', title: 'A page' },
        { url: 'https://b.example/', title: '' },
      ],
      [{ url: 'https://c.example/', title: 'C | with pipe' }],
    ]);
  });

  it('skips lines without a URL protocol', () => {
    expect(parseImportText('wikipedia.org | Wiki\nhttps://ok.example/ | OK\njust words')).toEqual([
      [{ url: 'https://ok.example/', title: 'OK' }],
    ]);
  });

  it('accepts CRLF line endings and surrounding whitespace', () => {
    expect(parseImportText('  https://a.example/ |  A  \r\n\r\nhttps://b.example/\r\n')).toEqual([
      [{ url: 'https://a.example/', title: 'A' }],
      [{ url: 'https://b.example/', title: '' }],
    ]);
  });

  it('round-trips exported text', () => {
    const groups = [
      [
        { url: 'https://a.example/', title: 'A' },
        { url: 'about:blank', title: '' },
      ],
      [{ url: 'file:///tmp/x.html', title: 'X | Y' }],
    ];
    expect(parseImportText(exportText(groups))).toEqual(groups);
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import { createFolder, editTab, importGroups, updateItem } from '../src/mutations';
import { exportHtml } from '../src/textio';
import { ListView } from '../src/view';

const tab = (url: string, title: string) => ({ url, title, favIconUrl: '' });
const headings = (html: string) => [...html.matchAll(/<h(\d)[^>]*>(.*?)<\/h\1>/g)].map((m) => `h${m[1]} ${m[2]}`);

describe('exportHtml', () => {
  it('nests a folder: its title as h1, its groups as h2, a sub-folder as h2 with its groups as h3', async () => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'Research & <notes>'));
    const sub = await s.transact((tx) => createFolder(tx, f, 'Sub'));
    await s.transact((tx) =>
      importGroups(tx, [[tab('https://s1.example/', 'S1'), tab('https://s2.example/', 'S2')]], sub),
    );
    const [g] = await s.transact((tx) => importGroups(tx, [[tab('http://[a"x"&y=1', '<script>alert(1)</script>')]], f));
    await s.transact((tx) => updateItem(tx, g!, { title: 'Work' }));
    const html = exportHtml(new ListView(s.all()), f);

    expect(headings(html)).toEqual(['h1 Research &amp; &lt;notes&gt;', 'h2 Work', 'h2 Sub', 'h3 2 tabs']);
    expect(html).toContain('<title>Research &amp; &lt;notes&gt;</title>');
    expect(html).toContain('href="http://[a&quot;x&quot;&amp;y=1"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;</a>');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<link|<style/);
  });

  it('exports a group with its shown tab titles and notes under them', async () => {
    const s = new MemoryStore('dev1');
    const [g] = await s.transact((tx) =>
      importGroups(tx, [[tab('https://a.example/', 'A'), tab('https://b.example/', '')]]),
    );
    const view0 = new ListView(s.all());
    const a = view0.tabs(g!)[0]!;
    await s.transact((tx) => editTab(tx, a.id, { title: 'Renamed', notes: 'read <first>' }));
    const html = exportHtml(new ListView(s.all()), g!, (n) => `${n} onglets`);

    expect(headings(html)).toEqual(['h1 2 onglets']);
    expect(html).toMatch(/<a href="https:\/\/a\.example\/"[^>]*>Renamed<\/a>.*read &lt;first&gt;/s);
    expect(html).toContain('>https://b.example/</a>');
  });
});

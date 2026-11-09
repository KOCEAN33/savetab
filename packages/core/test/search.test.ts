import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import { createFolder, editTab, moveItems, storeTabs, updateItem } from '../src/mutations';
import { search, type SearchQuery } from '../src/search';
import { ListView } from '../src/view';
import { defaultSettings } from '../src/model';

const settings = { ...defaultSettings, id: 'settings' };
const tab = (url: string, title: string) => ({ url, title, favIconUrl: '' });

const q = (patch: Partial<SearchQuery>): SearchQuery => ({
  text: '',
  caseSensitive: false,
  wholeWords: false,
  createdFrom: null,
  createdTo: null,
  starred: false,
  tasks: false,
  hasNotes: false,
  namedOnly: false,
  archived: 'any',
  folderId: null,
  ...patch,
});

async function fixture() {
  const s = new MemoryStore('dev1');
  const work = await s.transact((tx) => createFolder(tx, null, 'Work'));
  const g1 = (await s.transact((tx) =>
    storeTabs(tx, [tab('https://svelte.dev/docs', 'Svelte Docs'), tab('https://kr.example/', '스벨트 입문')], settings),
  ))!;
  await s.transact((tx) => moveItems(tx, [g1], work, null));
  const g2 = (await s.transact((tx) =>
    storeTabs(
      tx,
      [tab('https://news.example/', 'Daily news'), tab('https://svelteish.example/', 'Sveltekit tips')],
      settings,
    ),
  ))!;
  await s.transact((tx) => updateItem(tx, g2, { title: 'Reading' }));
  const v = new ListView(s.all());
  const [docs, kr] = v.tabs(g1);
  const [news, tips] = v.tabs(g2);
  return { s, work, g1, g2, docs: docs!, kr: kr!, news: news!, tips: tips! };
}

const tabIds = (s: MemoryStore, query: SearchQuery) =>
  search(new ListView(s.all()), query)
    .groups.flatMap((r) => r.tabs.map((t) => t.id))
    .sort();

describe('search', () => {
  it('matches every term against title, URL, and notes, ignoring case by default', async () => {
    const f = await fixture();
    await f.s.transact((tx) => editTab(tx, f.news.id, { notes: 'about SVELTE runes' }));
    expect(tabIds(f.s, q({ text: 'svelte' }))).toEqual([f.docs.id, f.news.id, f.tips.id].sort());
    expect(tabIds(f.s, q({ text: 'svelte docs' }))).toEqual([f.docs.id]);
    expect(tabIds(f.s, q({ text: '입문' }))).toEqual([f.kr.id]);
    expect(search(new ListView(f.s.all()), q({ text: 'svelte' })).count).toBe(3);
  });

  it('honours case sensitivity and whole words', async () => {
    const f = await fixture();
    expect(tabIds(f.s, q({ text: 'svelte', caseSensitive: true }))).toEqual([f.docs.id, f.tips.id].sort());
    expect(tabIds(f.s, q({ text: 'Svelte', wholeWords: true }))).toEqual([f.docs.id]);
  });

  it('lists a matching group with all its tabs', async () => {
    const f = await fixture();
    const r = search(new ListView(f.s.all()), q({ text: 'reading' }));
    expect(r.groups.map((g) => g.group.id)).toEqual([f.g2]);
    expect(r.groups[0]!.tabs.map((t) => t.id)).toEqual([f.news.id, f.tips.id]);
    expect(r.count).toBe(1);
  });

  it('filters by star, task, notes, archive state, and named groups', async () => {
    const f = await fixture();
    await f.s.transact(async (tx) => {
      await updateItem(tx, f.docs.id, { star: true });
      await updateItem(tx, f.kr.id, { task: 'pending', archived: true });
      await editTab(tx, f.news.id, { notes: 'n' });
    });
    expect(tabIds(f.s, q({ starred: true }))).toEqual([f.docs.id]);
    expect(tabIds(f.s, q({ tasks: true }))).toEqual([f.kr.id]);
    expect(tabIds(f.s, q({ hasNotes: true }))).toEqual([f.news.id]);
    expect(tabIds(f.s, q({ archived: 'only' }))).toEqual([f.kr.id]);
    expect(tabIds(f.s, q({ archived: 'none', text: 'svelte' }))).toEqual([f.docs.id, f.tips.id].sort());
    expect(tabIds(f.s, q({ namedOnly: true }))).toEqual([f.news.id, f.tips.id].sort());
  });

  it('filters by creation date and restricts to a folder', async () => {
    const f = await fixture();
    const v = new ListView(f.s.all());
    const times = [f.docs, f.kr, f.news, f.tips].map((t) => v.get(t.id)!.createdAt);
    const first = Math.min(...times);
    const last = Math.max(...times);
    expect(tabIds(f.s, q({ createdFrom: last + 1 }))).toEqual([]);
    expect(tabIds(f.s, q({ createdTo: first - 1 }))).toEqual([]);
    expect(tabIds(f.s, q({ createdFrom: first, createdTo: last }))).toHaveLength(4);
    expect(tabIds(f.s, q({ text: 'svelte', folderId: f.work }))).toEqual([f.docs.id]);
  });
});

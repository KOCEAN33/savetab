import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import { editTab, emptyTrash, storeTabs, trashItems } from '../src/mutations';
import { linkId, linkOf, normalizeUrl, tabTitle } from '../src/link';
import { liveChildren } from '../src/query';
import { defaultSettings, type Settings, type Tab } from '../src/model';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings, id: 'settings', ...patch });
const tab = (url: string, title: string) => ({ url, title, favIconUrl: '' });

async function firstTab(store: MemoryStore, groupId: string): Promise<Tab> {
  return (await liveChildren(store, groupId))[0] as Tab;
}

async function shown(store: MemoryStore, t: Tab) {
  const link = await linkOf(store, t.url);
  return { title: tabTitle(t, link), notes: link?.notes ?? '' };
}

describe('normalizeUrl', () => {
  it('lowercases scheme and host and adds the root path', () => {
    expect(normalizeUrl('HTTPS://Example.COM')).toBe('https://example.com/');
  });

  it('keeps a string that is not a URL', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('Link records', () => {
  it('shares a title and notes edited on one copy with every copy of the URL', async () => {
    const s = new MemoryStore('dev1');
    const g1 = (await s.transact((tx) => storeTabs(tx, [tab('https://a.example/', 'A1')], settings())))!;
    const g2 = (await s.transact((tx) => storeTabs(tx, [tab('HTTPS://A.example', 'A2')], settings())))!;
    const second = await firstTab(s, g2);
    await s.transact((tx) => editTab(tx, second.id, { title: 'Renamed', notes: 'read later' }));

    expect(await shown(s, await firstTab(s, g1))).toEqual({ title: 'Renamed', notes: 'read later' });
    expect(await shown(s, await firstTab(s, g2))).toEqual({ title: 'Renamed', notes: 'read later' });
  });

  it('keeps the first title of a URL unless titleOnDuplicate is update', async () => {
    const s = new MemoryStore('dev1');
    const g1 = (await s.transact((tx) => storeTabs(tx, [tab('https://a.example/', 'Old')], settings())))!;
    await s.transact((tx) => storeTabs(tx, [tab('https://a.example/', 'Newer')], settings()));
    expect((await shown(s, await firstTab(s, g1))).title).toBe('Old');

    await s.transact((tx) =>
      storeTabs(tx, [tab('https://a.example/', 'Newest')], settings({ titleOnDuplicate: 'update' })),
    );
    expect((await shown(s, await firstTab(s, g1))).title).toBe('Newest');
  });

  it('gives a URL the same link id on every device, so concurrent stores merge into one link', async () => {
    const a = new MemoryStore('dev1');
    const b = new MemoryStore('dev2');
    await a.transact((tx) => storeTabs(tx, [tab('https://a.example/', 'From A')], settings()));
    await b.transact((tx) => storeTabs(tx, [tab('https://a.example/', 'From B')], settings()));
    const aLog = [...a.log];
    a.applyRemote(b.log);
    b.applyRemote(aLog);

    const id = linkId('https://a.example/');
    expect(await a.get(id)).toEqual(await b.get(id));
    expect((await a.get(id))?.kind).toBe('link');
  });

  it('purges a link with the trash once no tab has its URL, and keeps it while one does', async () => {
    const s = new MemoryStore('dev1');
    const g1 = (await s.transact((tx) => storeTabs(tx, [tab('https://a.example/', 'A')], settings())))!;
    const g2 = (await s.transact((tx) => storeTabs(tx, [tab('https://a.example/', 'A')], settings())))!;
    await s.transact((tx) => trashItems(tx, [g1]));
    await s.transact((tx) => emptyTrash(tx));
    expect(await s.get(linkId('https://a.example/'))).toMatchObject({ purged: false, title: 'A' });

    await s.transact((tx) => trashItems(tx, [g2]));
    await s.transact((tx) => emptyTrash(tx));
    expect(await s.get(linkId('https://a.example/'))).toMatchObject({ purged: true, title: '', url: '' });
  });
});

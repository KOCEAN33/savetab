import { describe, expect, it } from 'vitest';
import { CryptoError, openShare, sealShare } from '../src/crypto';
import { MemoryStore } from '../src/memory';
import { createFolder, editTab, importGroups, MissingError, setShare, updateItem } from '../src/mutations';
import { shareContent, type ShareContent } from '../src/textio';
import { ListView } from '../src/view';

const tab = (url: string, title: string) => ({ url, title, favIconUrl: '' });
const seq = (start: number, length: number) => Uint8Array.from({ length }, (_, i) => start + i);

describe('shareContent', () => {
  it('copies a folder: its groups, then a sub-folder with its own groups, with shown titles and notes', async () => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'Research'));
    const sub = await s.transact((tx) => createFolder(tx, f, 'Sub'));
    await s.transact((tx) => importGroups(tx, [[tab('https://s1.example/', 'S1'), tab('https://s2.example/', '')]], sub));
    const [g] = await s.transact((tx) => importGroups(tx, [[tab('https://a.example/', 'A')]], f));
    await s.transact((tx) => updateItem(tx, g!, { title: 'Work', notes: 'group note' }));
    await s.transact((tx) => updateItem(tx, f, { notes: 'folder note' }));
    const a = new ListView(s.all()).tabs(g!)[0]!;
    await s.transact((tx) => editTab(tx, a.id, { title: 'Renamed', notes: 'tab note' }));

    expect(shareContent(new ListView(s.all()), f)).toEqual({
      v: 1,
      title: 'Research',
      notes: 'folder note',
      items: [
        {
          kind: 'group',
          title: 'Work',
          notes: 'group note',
          tabs: [{ url: 'https://a.example/', title: 'Renamed', notes: 'tab note' }],
        },
        {
          kind: 'folder',
          title: 'Sub',
          notes: '',
          items: [
            {
              kind: 'group',
              title: '2 tabs',
              notes: '',
              tabs: [
                { url: 'https://s1.example/', title: 'S1', notes: '' },
                { url: 'https://s2.example/', title: '', notes: '' },
              ],
            },
          ],
        },
      ],
    });
  });

  it('copies a group as a root that holds that one group, labeled by its tab count when it has no title', async () => {
    const s = new MemoryStore('dev1');
    const [g] = await s.transact((tx) => importGroups(tx, [[tab('https://a.example/', 'A')]]));
    const group = { kind: 'group', title: '1 onglet', notes: '', tabs: [{ url: 'https://a.example/', title: 'A', notes: '' }] };
    expect(shareContent(new ListView(s.all()), g!, (n) => `${n} onglet`)).toEqual({
      v: 1,
      title: '1 onglet',
      notes: '',
      items: [group],
    });
  });

  it('gives nothing for an item that is gone', () => {
    expect(shareContent(new ListView([]), 'missing')).toBeUndefined();
  });
});

describe('share blob', () => {
  const KEY = seq(0x10, 32);
  const CONTENT: ShareContent = {
    v: 1,
    title: 'Exämple',
    notes: '',
    items: [{ kind: 'group', title: 'G', notes: '', tabs: [{ url: 'https://a.example/', title: 'A', notes: '' }] }],
  };

  it('seals the content as JSON under the share key and the AAD savetab-share-v1', async () => {
    const blob = await sealShare(KEY, CONTENT);
    expect(blob[0]).toBe(1);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: blob.slice(1, 13), additionalData: new TextEncoder().encode('savetab-share-v1') },
      await crypto.subtle.importKey('raw', KEY, 'AES-GCM', false, ['decrypt']),
      blob.slice(13),
    );
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(CONTENT);
    expect(await openShare(KEY, blob)).toEqual(CONTENT);
  });

  it('rejects another key and a damaged blob', async () => {
    const blob = await sealShare(KEY, CONTENT);
    await expect(openShare(seq(0x11, 32), blob)).rejects.toThrow(CryptoError);
    const damaged = blob.map((b, i) => (i === blob.length - 1 ? b ^ 1 : b));
    await expect(openShare(KEY, damaged)).rejects.toThrow(CryptoError);
  });
});

describe('setShare', () => {
  const SHARE = { id: '0190a000-0000-4000-8000-000000000001', key: 'a2V5', expiresAt: 1_800_000_000_000 };

  it('stores a share on a group and on a folder, reaches another device, and clears with null', async () => {
    const a = new MemoryStore('dev1');
    const f = await a.transact((tx) => createFolder(tx, null, 'F'));
    const [g] = await a.transact((tx) => importGroups(tx, [[tab('https://a.example/', 'A')]], f));
    await a.transact((tx) => setShare(tx, g!, SHARE));
    await a.transact((tx) => setShare(tx, f, SHARE));

    const b = new MemoryStore('dev2');
    await b.applyRemote(a.log);
    const seen = new ListView(b.all());
    expect(seen.get(g!)).toMatchObject({ share: SHARE });
    expect(seen.get(f)).toMatchObject({ share: SHARE });

    await a.transact((tx) => setShare(tx, g!, null));
    expect(new ListView(a.all()).get(g!)).toMatchObject({ share: null });
  });

  it('refuses a tab and an item that is gone', async () => {
    const a = new MemoryStore('dev1');
    const [g] = await a.transact((tx) => importGroups(tx, [[tab('https://a.example/', 'A')]]));
    const t = new ListView(a.all()).tabs(g!)[0]!;
    await expect(a.transact((tx) => setShare(tx, t.id, SHARE))).rejects.toBeInstanceOf(MissingError);
    await expect(a.transact((tx) => setShare(tx, 'missing', SHARE))).rejects.toBeInstanceOf(MissingError);
  });
});

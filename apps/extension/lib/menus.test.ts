import { describe, expect, it } from 'vitest';
import { createFolder, defaultSettings, ListView, MemoryStore, storeTabs, trashItems, updateItem } from '@savetab/core';
import { sendTargets } from './menus';

const settings = { ...defaultSettings, id: 'settings' };

describe('sendTargets', () => {
  it('lists 5 recent open groups, then named open groups in list order, 20 in all', async () => {
    const s = new MemoryStore('dev1');
    const group = async (title: string, patch: Record<string, unknown> = {}) => {
      const id = (await s.transact((tx) =>
        storeTabs(tx, [{ url: `https://${title || 'u'}.example/`, title, favIconUrl: '' }], settings),
      ))!;
      await s.transact((tx) => updateItem(tx, id, { title, ...patch }));
      return id;
    };
    const n: string[] = [];
    for (let i = 0; i < 25; i++) n.push(await group(`N${i}`));
    const locked = await group('Locked', { locked: true });
    const unnamed = await group('');
    const trashed = await group('Trashed');
    await s.transact((tx) => trashItems(tx, [trashed]));
    const folder = await s.transact((tx) => createFolder(tx, null, 'F'));

    const recent = [folder, locked, unnamed, n[3]!, trashed, n[7]!, n[1]!, n[9]!, n[11]!, n[13]!];
    const titles = sendTargets(new ListView(s.all()), recent).map((t) => t.title);
    expect(titles).toEqual([
      '1 tab',
      'N3',
      'N7',
      'N1',
      'N9',
      ...[24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10].map((i) => `N${i}`),
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import { createFolder, editTab, importGroups, restoreSnapshot, updateItem } from '../src/mutations';
import { ListView } from '../src/view';

const tab = (url: string, title: string) => ({ url, title, favIconUrl: '' });

describe('restoreSnapshot', () => {
  it('writes every record back through the outbox, so the list, links, and settings return', async () => {
    const a = new MemoryStore('dev1');
    const f = await a.transact((tx) => createFolder(tx, null, 'F'));
    const [g] = await a.transact((tx) => importGroups(tx, [[tab('https://a.example/', 'A'), tab('https://b.example/', 'B')]], f));
    await a.transact((tx) => updateItem(tx, g!, { title: 'Work', star: true }));
    const first = new ListView(a.all()).tabs(g!)[0]!;
    await a.transact((tx) => editTab(tx, first.id, { title: 'Renamed', notes: 'n' }));
    await a.transact((tx) => updateItem(tx, 'settings', { kind: 'settings', urlDisplay: 'full' }));

    const b = new MemoryStore('dev2');
    await b.transact((tx) => restoreSnapshot(tx, a.all()));

    const before = new ListView(a.all());
    const after = new ListView(b.all());
    expect(after.children(null).map((i) => [i.id, i.title])).toEqual([[f, 'F']]);
    expect(after.get(g!)).toMatchObject({ title: 'Work', star: true, parentId: f });
    expect(after.tabs(g!).map((t) => [t.id, after.title(t), after.notes(t)])).toEqual([
      [first.id, 'Renamed', 'n'],
      [before.tabs(g!)[1]!.id, 'B', ''],
    ]);
    expect(after.settings.urlDisplay).toBe('full');
    expect(b.log.map((op) => op.itemId).sort()).toEqual(a.all().map((r) => r.id).sort());
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/memory';
import { createFolder, editTab, importGroups, updateItem, updateSettings } from '../src/mutations';
import { mergeRecords, restoreSnapshot } from '../src/snapshot';
import { ListView } from '../src/view';

const tab = (url: string, title: string) => ({ url, title, favIconUrl: '' });

describe('restoreSnapshot', () => {
  it('writes every record back through the outbox, so the list, links, and settings return', async () => {
    const a = new MemoryStore('dev1');
    const f = await a.transact((tx) => createFolder(tx, null, 'F'));
    const [g] = await a.transact((tx) =>
      importGroups(tx, [[tab('https://a.example/', 'A'), tab('https://b.example/', 'B')]], f),
    );
    await a.transact((tx) => updateItem(tx, g!, { title: 'Work', star: true }));
    const first = new ListView(a.all()).tabs(g!)[0]!;
    await a.transact((tx) => editTab(tx, first.id, { title: 'Renamed', notes: 'n' }));
    await a.transact((tx) => updateSettings(tx, { urlDisplay: 'full' }));

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
    expect([...new Set(b.log.map((op) => op.itemId))].sort()).toEqual(
      a
        .all()
        .map((r) => r.id)
        .sort(),
    );
  });
});

describe('mergeRecords', () => {
  it('gives a device the list, links, and settings of the records, and queues nothing for upload', async () => {
    const a = new MemoryStore('dev1');
    const f = await a.transact((tx) => createFolder(tx, null, 'F'));
    const [g] = await a.transact((tx) => importGroups(tx, [[tab('https://a.example/', 'A')]], f));
    const first = new ListView(a.all()).tabs(g!)[0]!;
    await a.transact((tx) => editTab(tx, first.id, { title: 'Renamed', notes: 'n' }));
    await a.transact((tx) => updateSettings(tx, { urlDisplay: 'full' }));

    const b = new MemoryStore('dev2');
    await b.transact((tx) => mergeRecords(tx, a.all()));

    const after = new ListView(b.all());
    expect(after.children(null).map((i) => [i.id, i.title])).toEqual([[f, 'F']]);
    expect(after.tabs(g!).map((t) => [t.id, after.title(t), after.notes(t)])).toEqual([[first.id, 'Renamed', 'n']]);
    expect(after.settings.urlDisplay).toBe('full');
    expect(b.log).toEqual([]);
  });

  it('keeps a field the device wrote after the records were taken, and takes one written before', async () => {
    const a = new MemoryStore('dev1');
    const [g] = await a.transact((tx) => importGroups(tx, [[tab('https://a.example/', 'A')]], null));
    const b = new MemoryStore('dev2');
    await b.applyRemote(a.log);

    await b.transact((tx) => updateItem(tx, g!, { star: true }));
    await a.transact((tx) => updateItem(tx, g!, { title: 'From A' }));
    const records = a.all();
    await b.transact((tx) => updateItem(tx, g!, { title: 'From B' }));

    const c = new MemoryStore('dev3');
    await c.applyRemote(b.log);
    await c.transact((tx) => mergeRecords(tx, records));
    expect(new ListView(c.all()).get(g!)).toMatchObject({ title: 'From B', star: true });

    const d = new MemoryStore('dev4');
    await d.applyRemote(b.log.slice(0, -1));
    await d.transact((tx) => mergeRecords(tx, records));
    expect(new ListView(d.all()).get(g!)).toMatchObject({ title: 'From A', star: true });
  });
});

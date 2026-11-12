import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyOp,
  createFolder,
  emptyTrash,
  hlcMs,
  importGroups,
  isLive,
  linkId,
  ListView,
  MAX_SKEW_MS,
  MemoryStore,
  moveItems,
  normalizeUrl,
  OP_VERSION,
  readSettings,
  restoreSnapshot,
  SETTINGS_ID,
  tick,
  trashItems,
  UnsupportedOpError,
  updateItem,
  updateSettings,
  type ItemRecord,
  type Kind,
  type Op,
} from '../src/index';

const tab = (n: string) => ({ url: `https://${n}.example/`, title: n.toUpperCase(), favIconUrl: '' });

const op = (kind: Kind, hlc: string, fields: Record<string, unknown>, itemId = 'i1', v = OP_VERSION): Op => ({
  v,
  opId: `${itemId}-${hlc}`,
  itemId,
  kind,
  hlc,
  fields,
});

const h = (ms: number, dev = 'devX') => tick(null, ms, dev);

/**
 * Returns a function that exchanges ops between two stores until neither log grows.
 * It remembers how many ops of each log the other store has already applied.
 */
function link(a: MemoryStore, b: MemoryStore) {
  let aSeen = 0;
  let bSeen = 0;
  return async () => {
    for (let round = 0; round < 20; round++) {
      const fromA = a.log.slice(aSeen);
      aSeen = a.log.length;
      await b.applyRemote(fromA);
      const fromB = b.log.slice(bSeen);
      bSeen = b.log.length;
      await a.applyRemote(fromB);
      if (a.log.length === aSeen && b.log.length === bSeen) return;
    }
    throw new Error('logs did not settle');
  };
}

const byId = (recs: ItemRecord[]) => [...recs].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

const title = async (s: MemoryStore, id: string) => (await s.get(id))?.title;

afterEach(() => {
  vi.useRealTimers();
});

describe('syncable-field allowlist', () => {
  it('applies only allowlisted fields of a hostile op and keeps id, kind, and other clocks', () => {
    const created = applyOp(
      { id: 't1', clocks: {} },
      op('tab', h(1_000), { title: 'a', url: 'https://a.example/' }, 't1'),
    );
    const hostile = h(2_000);
    const rec = applyOp(
      created,
      op('tab', hostile, { id: 'evil', clocks: {}, kind: 'folder', title: 'x', bogus: 1 }, 't1'),
    );

    expect(rec.id).toBe('t1');
    expect(rec.kind).toBe('tab');
    expect(rec.title).toBe('x');
    expect(rec.url).toBe('https://a.example/');
    expect('bogus' in rec).toBe(false);
    expect(rec.clocks).toEqual({ title: hostile, url: h(1_000) });
  });

  it('sets kind from op.kind on a record without one', () => {
    const rec = applyOp({ id: 'g1', clocks: {} }, op('group', h(1_000), { title: 'G' }, 'g1'));
    expect(rec.kind).toBe('group');
    expect(rec.title).toBe('G');
  });

  it('changes nothing when the op kind differs from the record kind', () => {
    const tabRec = applyOp({ id: 't1', clocks: {} }, op('tab', h(1_000), { title: 'a' }, 't1'));
    const after = applyOp(tabRec, op('folder', h(2_000), { title: 'y', star: true }, 't1'));
    expect(after).toEqual(tabRec);
  });

  it('drops a tab-only field from a folder op', () => {
    const rec = applyOp(
      { id: 'f1', clocks: {} },
      op('folder', h(1_000), { title: 'F', url: 'https://x.example/' }, 'f1'),
    );
    expect(rec.title).toBe('F');
    expect('url' in rec).toBe(false);
    expect(rec.clocks).toEqual({ title: h(1_000) });
  });

  it('drops tree fields from a link op', () => {
    const rec = applyOp(
      { id: 'l1', clocks: {} },
      op('link', h(1_000), { url: 'https://a.example/', title: 'A', parentId: 'g1', order: 'a0' }, 'l1'),
    );
    expect(rec).toMatchObject({ kind: 'link', url: 'https://a.example/', title: 'A' });
    expect('parentId' in rec).toBe(false);
    expect('order' in rec).toBe(false);
  });

  it('keeps exclude:<host> and listed settings fields and drops the rest of a settings op', () => {
    const rec = applyOp(
      { id: SETTINGS_ID, clocks: {} },
      op(
        'settings',
        h(1_000),
        { 'exclude:a.example': true, urlDisplay: 'full', excludedDomains: ['z.example'], title: 'no' },
        SETTINGS_ID,
      ),
    );
    expect(rec['exclude:a.example']).toBe(true);
    expect(rec.urlDisplay).toBe('full');
    expect('excludedDomains' in rec).toBe(false);
    expect('title' in rec).toBe(false);
  });

  it('throws UnsupportedOpError for an op from a newer version', () => {
    const newer = op('tab', h(1_000), { title: 'a' }, 't1', OP_VERSION + 1);
    expect(() => applyOp({ id: 't1', clocks: {} }, newer)).toThrow(UnsupportedOpError);
    expect(() => applyOp({ id: 't1', clocks: {} }, op('tab', h(1_000), { title: 'a' }, 't1'))).not.toThrow();
  });

  it('keeps per-field last-writer-wins', () => {
    const newer = applyOp({ id: 't1', clocks: {} }, op('tab', h(2_000), { title: 'new' }, 't1'));
    const rec = applyOp(newer, op('tab', h(1_000), { title: 'old', star: true }, 't1'));
    expect(rec.title).toBe('new');
    expect(rec.star).toBe(true);
  });

  it('stamps every local op with the version and the item kind, and keeps kind out of fields', async () => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const [g] = await s.transact((tx) => importGroups(tx, [[tab('a'), tab('b')]], f));
    const before = s.log.length;
    await s.transact((tx) => updateItem(tx, g!, { title: 'Renamed' }));

    expect(s.log.length).toBeGreaterThan(0);
    for (const o of s.log) {
      expect(o.v).toBe(OP_VERSION);
      expect(o.kind).toBe((await s.get(o.itemId))?.kind);
      expect('kind' in o.fields).toBe(false);
    }
    const renameOps = s.log.slice(before).filter((o) => o.itemId === g);
    expect(renameOps.length).toBeGreaterThan(0);
    for (const o of renameOps) expect(o.kind).toBe('group');
  });

  it('rejects tx.write with a field outside the kind list and stores nothing for the item', async () => {
    const s = new MemoryStore('dev1');
    const logBefore = s.log.length;
    await expect(
      s.transact(async (tx) => {
        await tx.write('new1', { kind: 'folder', title: 'x', bogus: 1 });
      }),
    ).rejects.toThrow('does not sync');
    expect(await s.get('new1')).toBeUndefined();
    expect(s.log.slice(logBefore).filter((o) => o.itemId === 'new1')).toEqual([]);

    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const existing = await s.get(f);
    await expect(
      s.transact(async (tx) => {
        await tx.write(f, { title: 'changed', bogus: 1 });
      }),
    ).rejects.toThrow('does not sync');
    expect(await s.get(f)).toEqual(existing);
  });

  it.each(['parentId', 'order', 'kind', 'trashedAt'])('rejects an updateItem patch holding %s', async (field) => {
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    const g = await s.transact((tx) => createFolder(tx, null, 'G'));
    const before = await s.get(g);
    const values: Record<string, unknown> = { parentId: f, order: 'zz', kind: 'tab', trashedAt: 5 };
    await expect(
      s.transact((tx) => updateItem(tx, g, { title: 'x', [field]: values[field] } as never)),
    ).rejects.toThrow('cannot be edited in place');
    expect(await s.get(g)).toEqual(before);
  });
});

describe('excluded domains merge per domain', () => {
  it('sets the whole list and reads it back sorted', async () => {
    const s = new MemoryStore('dev1');
    await s.transact((tx) => updateSettings(tx, { excludedDomains: ['c.example', 'a.example', 'b.example'] }));
    expect(readSettings(await s.get(SETTINGS_ID)).excludedDomains).toEqual(['a.example', 'b.example', 'c.example']);
    await s.transact((tx) => updateSettings(tx, { excludedDomains: ['b.example'] }));
    expect(readSettings(await s.get(SETTINGS_ID)).excludedDomains).toEqual(['b.example']);
  });

  it('keeps both domains added on two devices offline', async () => {
    const a = new MemoryStore('devA');
    const b = new MemoryStore('devB');
    const sync = link(a, b);
    await a.transact((tx) => updateSettings(tx, { excludedDomains: ['a.example'] }));
    await sync();

    await a.transact((tx) => updateSettings(tx, { excludedDomains: ['a.example', 'b.example'] }));
    await b.transact((tx) => updateSettings(tx, { excludedDomains: ['a.example', 'c.example'] }));
    await sync();

    const want = ['a.example', 'b.example', 'c.example'];
    expect(readSettings(await a.get(SETTINGS_ID)).excludedDomains).toEqual(want);
    expect(readSettings(await b.get(SETTINGS_ID)).excludedDomains).toEqual(want);
  });

  it('merges a removal on one device with an addition on the other', async () => {
    const a = new MemoryStore('devA');
    const b = new MemoryStore('devB');
    const sync = link(a, b);
    await a.transact((tx) => updateSettings(tx, { excludedDomains: ['a.example', 'b.example'] }));
    await sync();

    await a.transact((tx) => updateSettings(tx, { excludedDomains: ['b.example'] }));
    await b.transact((tx) => updateSettings(tx, { excludedDomains: ['a.example', 'b.example', 'd.example'] }));
    await sync();

    const want = ['b.example', 'd.example'];
    expect(readSettings(await a.get(SETTINGS_ID)).excludedDomains).toEqual(want);
    expect(readSettings(await b.get(SETTINGS_ID)).excludedDomains).toEqual(want);
  });

  it('still updates other settings', async () => {
    const s = new MemoryStore('dev1');
    await s.transact((tx) => updateSettings(tx, { urlDisplay: 'full' }));
    expect(readSettings(await s.get(SETTINGS_ID)).urlDisplay).toBe('full');
  });
});

describe('re-homing a live item under a purged parent', () => {
  it('moves a group to the root when its new folder was purged on another device', async () => {
    const a = new MemoryStore('devA');
    const b = new MemoryStore('devB');
    const sync = link(a, b);
    const f = await a.transact((tx) => createFolder(tx, null, 'F'));
    const [hId] = await a.transact((tx) => importGroups(tx, [[tab('a')]]));
    const H = hId!;
    await a.transact((tx) => updateItem(tx, H, { title: 'H' }));
    await sync();

    await a.transact((tx) => trashItems(tx, [f]));
    await a.transact((tx) => emptyTrash(tx));
    await b.transact((tx) => moveItems(tx, [H], f, null));
    await sync();

    for (const s of [a, b]) {
      const rec = await s.get(H);
      expect(isLive(rec)).toBe(true);
      expect(rec?.parentId).toBeNull();
      expect(new ListView(s.all()).children(null).map((i) => i.id)).toContain(H);
    }
    expect(byId(a.all())).toEqual(byId(b.all()));
  });

  it('gives a tab a live root group when its new group was purged on another device', async () => {
    const a = new MemoryStore('devA');
    const b = new MemoryStore('devB');
    const sync = link(a, b);
    const [g1, g2] = await a.transact((tx) =>
      importGroups(tx, [
        [tab('a'), tab('b')],
        [tab('c'), tab('d')],
      ]),
    );
    await sync();

    const T = new ListView(b.all()).tabs(g2!)[0]!.id;
    await a.transact((tx) => trashItems(tx, [g1!]));
    await a.transact((tx) => emptyTrash(tx));
    await b.transact((tx) => moveItems(tx, [T], g1!, null));
    await sync();

    const parents: unknown[] = [];
    for (const s of [a, b]) {
      const rec = await s.get(T);
      expect(isLive(rec)).toBe(true);
      const parent = await s.get(rec!.parentId as string);
      expect(isLive(parent)).toBe(true);
      expect(parent?.kind).toBe('group');
      expect(parent?.parentId).toBeNull();
      parents.push(rec!.parentId);
    }
    expect(parents[0]).toBe(parents[1]);
    expect(byId(a.all())).toEqual(byId(b.all()));
  });

  it('makes one group when both devices re-home the tab before they sync again', async () => {
    const a = new MemoryStore('devA');
    const b = new MemoryStore('devB');
    const [g1, g2] = await a.transact((tx) =>
      importGroups(tx, [
        [tab('a'), tab('b')],
        [tab('c'), tab('d')],
      ]),
    );
    await b.applyRemote([...a.log]);
    const T = new ListView(b.all()).tabs(g2!)[0]!.id;
    await a.transact((tx) => trashItems(tx, [g1!]));
    await a.transact((tx) => emptyTrash(tx));
    await b.transact((tx) => moveItems(tx, [T], g1!, null));

    // Each device applies what the other had before either re-homed.
    const fromA = [...a.log];
    const fromB = [...b.log];
    await a.applyRemote(fromB);
    await b.applyRemote(fromA);
    await a.applyRemote([...b.log]);
    await b.applyRemote([...a.log]);

    for (const s of [a, b]) {
      const home = (await s.get(T))!.parentId as string;
      const liveGroups = s.all().filter((r) => r.kind === 'group' && isLive(r));
      expect(liveGroups.map((r) => r.id).sort()).toEqual([g2!, home].sort());
    }
  });
});

describe('restoreSnapshot keeps original clocks', () => {
  it('restores each field with the clock it had in the snapshot', async () => {
    const a = new MemoryStore('dev1');
    const f = await a.transact((tx) => createFolder(tx, null, 'F'));
    const [g] = await a.transact((tx) => importGroups(tx, [[tab('a'), tab('b')]], f));
    await a.transact((tx) => updateItem(tx, g!, { title: 'Work', star: true }));
    await a.transact((tx) => updateSettings(tx, { urlDisplay: 'full' }));
    const snapshot = [...a.all()];

    const fresh = new MemoryStore('dev2');
    await fresh.transact((tx) => restoreSnapshot(tx, snapshot));

    // The group's title clock is later than its parentId clock, so one record carries several clocks.
    const gSnap = snapshot.find((r) => r.id === g)!;
    expect(gSnap.clocks.title).not.toBe(gSnap.clocks.parentId);

    for (const snap of snapshot) {
      const restored = await fresh.get(snap.id);
      expect(restored).toBeDefined();
      for (const [field, clock] of Object.entries(snap.clocks)) {
        expect(restored!.clocks[field], `${snap.id}.${field}`).toBe(clock);
      }
    }
  });

  it('lets a newer rename on another device win over a restored snapshot', async () => {
    const a = new MemoryStore('dev1');
    const [gId] = await a.transact((tx) => importGroups(tx, [[tab('a')]]));
    const g = gId!;
    await a.transact((tx) => updateItem(tx, g, { title: 'Old' }));
    const snapshot = [...a.all()];

    const b = new MemoryStore('dev2');
    await b.applyRemote(a.log);
    await b.transact((tx) => updateItem(tx, g, { title: 'Newer' }));

    const restored = new MemoryStore('dev1b');
    await restored.transact((tx) => restoreSnapshot(tx, snapshot));

    await b.applyRemote(restored.log);
    expect(await title(b, g)).toBe('Newer');
    await restored.applyRemote(b.log);
    expect(await title(restored, g)).toBe('Newer');
  });

  it('gives a local write after the restore a clock later than every restored clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000_000);
    const a = new MemoryStore('dev1');
    const [gId] = await a.transact((tx) => importGroups(tx, [[tab('a')]]));
    const g = gId!;
    await a.transact((tx) => updateItem(tx, g, { title: 'Old', star: true }));
    const snapshot = [...a.all()];
    const restoredClocks = snapshot.flatMap((r) => Object.values(r.clocks));

    vi.setSystemTime(1_000);
    const r = new MemoryStore('dev1b');
    await r.transact((tx) => restoreSnapshot(tx, snapshot));
    const before = r.log.length;
    await r.transact((tx) => updateItem(tx, g, { title: 'Local', star: false }));

    const localOps = r.log.slice(before);
    expect(localOps.length).toBeGreaterThan(0);
    for (const o of localOps) {
      for (const c of restoredClocks) expect(o.hlc > c).toBe(true);
    }
    expect(await r.get(g)).toMatchObject({ title: 'Local', star: false });

    await a.applyRemote(r.log, 10_000_000);
    expect(await a.get(g)).toMatchObject({ title: 'Local', star: false });
  });
});

describe('clock skew', () => {
  const R = 1_000_000_000;

  async function folderAt(now: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const s = new MemoryStore('dev1');
    const f = await s.transact((tx) => createFolder(tx, null, 'F'));
    return { s, f };
  }

  it('reads the wall-clock ms back from a clock', () => {
    expect(hlcMs(tick(null, 123_456, 'dev1'))).toBe(123_456);
  });

  it('skips an op too far ahead of its receive time and does not advance the local clock', async () => {
    const { s, f } = await folderAt(R);
    const future = op('folder', tick(null, R + MAX_SKEW_MS + 1, 'devX'), { title: 'Future' }, f);
    await s.applyRemote([future], R);
    expect(await title(s, f)).toBe('F');

    const before = s.log.length;
    await s.transact((tx) => updateItem(tx, f, { title: 'Local' }));
    const local = s.log.slice(before).find((o) => o.itemId === f)!;
    expect(local.hlc < future.hlc).toBe(true);

    const honest = op('folder', tick(null, R + 1_000, 'devY'), { title: 'Honest' }, f);
    await s.applyRemote([honest], R);
    expect(await title(s, f)).toBe('Honest');
  });

  it('applies an op exactly at the skew limit', async () => {
    const { s, f } = await folderAt(R);
    const edge = op('folder', tick(null, R + MAX_SKEW_MS, 'devX'), { title: 'Edge' }, f);
    await s.applyRemote([edge], R);
    expect(await title(s, f)).toBe('Edge');
  });

  it('advances the local clock past an applied remote op even when the system time is earlier', async () => {
    const { s, f } = await folderAt(R);
    const ahead = op('folder', tick(null, R + 60_000, 'devX'), { title: 'Remote' }, f);
    await s.applyRemote([ahead], R);
    expect(await title(s, f)).toBe('Remote');

    const before = s.log.length;
    await s.transact((tx) => updateItem(tx, f, { title: 'Local' }));
    const local = s.log.slice(before).find((o) => o.itemId === f)!;
    expect(local.hlc > ahead.hlc).toBe(true);
    expect(await title(s, f)).toBe('Local');
  });
});

describe('normalizeUrl is engine-independent', () => {
  it('normalizes parser schemes', () => {
    expect(normalizeUrl('HTTPS://Example.COM')).toBe('https://example.com/');
  });

  it.each(['foo://Host/a/../b', 'chrome://crash', 'chrome://crash/', 'about:config', 'not a url'])(
    'returns %s exactly as given',
    (raw) => {
      expect(normalizeUrl(raw)).toBe(raw);
    },
  );

  it('gives distinct link ids to chrome://crash with and without a slash', () => {
    expect(linkId('chrome://crash')).not.toBe(linkId('chrome://crash/'));
  });

  it('gives the same link id to URLs that normalize alike', () => {
    expect(linkId('HTTPS://Example.COM')).toBe(linkId('https://example.com/'));
  });
});

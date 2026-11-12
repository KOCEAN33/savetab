import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CryptoError,
  defaultSettings,
  importDataKey,
  liveChildren,
  MAX_SKEW_MS,
  MemoryStore,
  mergeRecords,
  openOp,
  openSnapshot,
  randomKey,
  sealOp,
  sealSnapshot,
  storeTabs,
  updateItem,
  type ItemSource,
  type Op,
} from '@savetab/core';
import { db, joinSync, leaveSync, saveTokens, source, syncAccount, syncStatus, transact, type SyncAccount } from './db';
import { client, sync, SyncError, syncOnce } from './sync';

const USER = '0196f1c0-0000-7000-8000-000000000001';
const SERVER = 'https://sync.example';
const settings = { ...defaultSettings, id: 'settings' };
const tab = (n: string) => ({ url: `https://${n}.example/`, title: n, favIconUrl: '' });

interface Row {
  seq: number;
  id: string;
  deviceId: string;
  data: string;
  receivedAt: number;
}

/** The plan's HTTP API for one user, held in memory. */
class FakeServer {
  log: Row[] = [];
  calls: { call: string; bytes: number }[] = [];
  accessToken = 'access-1';
  refreshToken = 'refresh-1';
  pageSize = 500;
  pushStatus = 200;
  lastSeq = 0;
  snapshot?: { seq: number; data: string };
  /** Answers every snapshot upload as if another device's newer snapshot landed first. */
  snapshotRace = false;
  now = () => Date.now();

  receive(deviceId: string, id: string, data: Uint8Array): void {
    if (this.log.some((row) => row.id === id)) return;
    this.log.push({
      seq: ++this.lastSeq,
      id,
      deviceId,
      data: Buffer.from(data).toString('base64'),
      receivedAt: this.now(),
    });
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const text = typeof init.body === 'string' ? init.body : '';
    this.calls.push({ call: `${method} ${url.pathname}${url.search}`, bytes: text.length });
    if (url.origin !== SERVER) throw new TypeError('fetch failed');
    const route = `${method} ${url.pathname}`;
    if (route === 'POST /v1/auth/refresh') {
      if (JSON.parse(text).refreshToken !== this.refreshToken)
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      this.accessToken = 'access-2';
      this.refreshToken = 'refresh-2';
      return Response.json({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresIn: 3600,
        userId: USER,
        deviceId: 'dev-self',
      });
    }
    if (new Headers(init.headers).get('authorization') !== `Bearer ${this.accessToken}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (route === 'GET /v1/ops') {
      const after = Number(url.searchParams.get('after') ?? 0);
      if (this.snapshot && after < this.snapshot.seq) return Response.json({ error: 'snapshot_required' }, { status: 409 });
      const rest = this.log.filter((row) => row.seq > after);
      return Response.json({
        ops: rest.slice(0, this.pageSize),
        more: rest.length > this.pageSize,
        serverTime: this.now(),
      });
    }
    if (route === 'POST /v1/ops') {
      if (this.pushStatus !== 200) return Response.json({ error: 'internal' }, { status: this.pushStatus });
      for (const op of JSON.parse(text).ops) this.receive('dev-self', op.id, Buffer.from(op.data, 'base64'));
      return Response.json({ serverTime: this.now() });
    }
    if (route === 'GET /v1/snapshot') {
      return this.snapshot ? Response.json(this.snapshot) : Response.json({ error: 'no_snapshot' }, { status: 404 });
    }
    if (route === 'PUT /v1/snapshot') {
      const put = JSON.parse(text) as { seq: number; data: string };
      if (put.seq > this.lastSeq) return Response.json({ error: 'snapshot_ahead' }, { status: 409 });
      if (this.snapshotRace || (this.snapshot && this.snapshot.seq > put.seq)) {
        return Response.json({ error: 'stale_snapshot' }, { status: 409 });
      }
      this.takeSnapshot(put);
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  };

  takeSnapshot(snapshot: { seq: number; data: string }): void {
    this.snapshot = snapshot;
    this.log = this.log.filter((row) => row.seq > snapshot.seq);
  }

  snapshotPuts() {
    return this.calls.filter((c) => c.call === 'PUT /v1/snapshot');
  }

  pushes() {
    return this.calls.filter((c) => c.call === 'POST /v1/ops');
  }
}

let server: FakeServer;
let dataKey: Uint8Array;
let account: SyncAccount;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeServer();
  vi.stubGlobal('fetch', server.fetch);
  dataKey = randomKey();
  account = {
    serverUrl: SERVER,
    userId: USER,
    deviceId: 'dev-self',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    dataKey,
  };
});

afterEach(() => vi.unstubAllGlobals());

/** What a second device holds after it opens and merges everything on the server. */
async function replica(): Promise<MemoryStore> {
  const key = await importDataKey(dataKey);
  const store = new MemoryStore('replica');
  const ops = await Promise.all(server.log.map((row) => openOp(key, USER, row.id, Buffer.from(row.data, 'base64'))));
  await store.applyRemote(ops);
  return store;
}

/** The titles of every live tab, group by group. */
async function tabTitles(src: ItemSource): Promise<string[][]> {
  const groups = await liveChildren(src, null);
  const titles = await Promise.all(groups.map(async (g) => (await liveChildren(src, g.id)).map((t) => t.title)));
  return titles.sort();
}

/** Another device of the same user stores tabs and pushes them. */
async function otherDeviceStores(names: string[], key = dataKey): Promise<void> {
  const other = new MemoryStore(`other-${names.join('')}`);
  await other.transact((tx) => storeTabs(tx, names.map(tab), settings));
  const sealing = await importDataKey(key);
  for (const op of other.log) server.receive('dev-other', op.opId, await sealOp(sealing, USER, op));
}

describe('sync cycle', () => {
  it('does nothing before the device joins an account', async () => {
    await transact((tx) => storeTabs(tx, [tab('a')], settings));
    await syncOnce();
    expect(server.calls).toEqual([]);
  });

  it('uploads the records a device holds when it joins, even ones its outbox no longer lists', async () => {
    await transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings));
    await db.outbox.clear();
    await joinSync(account);
    await syncOnce();
    expect(await tabTitles(await replica())).toEqual([['a', 'b']]);
  });

  it('pushes a write made after joining and empties the outbox', async () => {
    await joinSync(account);
    await syncOnce();
    await transact((tx) => storeTabs(tx, [tab('later')], settings));
    await syncOnce();
    expect(await tabTitles(await replica())).toEqual([['later']]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('merges ops other devices pushed, across pages and across cycles', async () => {
    await joinSync(account);
    server.pageSize = 2;
    await otherDeviceStores(['c', 'd']);
    await syncOnce();
    expect(await tabTitles(source)).toEqual([['c', 'd']]);

    const seen = server.log.length;
    await otherDeviceStores(['e']);
    await syncOnce();
    expect(await tabTitles(source)).toEqual([['c', 'd'], ['e']]);
    expect(server.calls.at(-2)?.call).toContain(`after=${seen}`);
  });

  it('does not push while its clock runs more than MAX_SKEW_MS ahead of the server', async () => {
    await joinSync(account);
    await transact((tx) => storeTabs(tx, [tab('a')], settings));
    server.now = () => Date.now() - MAX_SKEW_MS - 60_000;
    await syncOnce();
    expect(server.pushes()).toEqual([]);

    server.now = () => Date.now() - MAX_SKEW_MS + 60_000;
    await syncOnce();
    expect(await tabTitles(await replica())).toEqual([['a']]);
  });

  it('refreshes an expired access token, keeps the new tokens, and finishes the cycle', async () => {
    await joinSync(account);
    await transact((tx) => storeTabs(tx, [tab('a')], settings));
    server.accessToken = 'access-expired-on-server';
    await syncOnce();
    expect(await syncAccount()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    expect(await tabTitles(await replica())).toEqual([['a']]);

    await syncOnce();
    expect(server.calls.filter((c) => c.call === 'POST /v1/auth/refresh')).toHaveLength(1);
  });

  it('fails the cycle when the refresh token is refused', async () => {
    await joinSync({ ...account, accessToken: 'stale', refreshToken: 'stale' });
    await expect(syncOnce()).rejects.toThrow(SyncError);
  });

  it('stops at an op that does not open and asks for it again next cycle', async () => {
    await joinSync(account);
    await otherDeviceStores(['x'], randomKey());
    await expect(syncOnce()).rejects.toThrow(CryptoError);
    await expect(syncOnce()).rejects.toThrow(CryptoError);
    expect(await tabTitles(source)).toEqual([]);
    expect(server.calls.map((c) => c.call).filter((c) => c.startsWith('GET /v1/ops'))).toEqual([
      'GET /v1/ops?after=0',
      'GET /v1/ops?after=0',
    ]);
  });

  it('keeps the outbox when a push fails and sends it in the next cycle', async () => {
    await joinSync(account);
    await transact((tx) => storeTabs(tx, [tab('a')], settings));
    server.pushStatus = 500;
    await expect(syncOnce()).rejects.toThrow(SyncError);
    server.pushStatus = 200;
    await syncOnce();
    expect(await tabTitles(await replica())).toEqual([['a']]);
  });

  it('splits a push so no request passes the 8 MiB limit', async () => {
    await joinSync(account);
    const groups: string[] = [];
    for (const n of ['a', 'b', 'c']) groups.push((await transact((tx) => storeTabs(tx, [tab(n)], settings)))!);
    for (const g of groups) await transact((tx) => updateItem(tx, g, { notes: 'n'.repeat(3 << 20) }));
    await syncOnce();
    expect(server.pushes().length).toBeGreaterThan(1);
    for (const push of server.pushes()) expect(push.bytes).toBeLessThanOrEqual(8 << 20);
    const notes = (await liveChildren(await replica(), null)).map((g) => (g.notes as string).length);
    expect(notes).toEqual([3 << 20, 3 << 20, 3 << 20]);
  });
});

/** Another device of the same user stores one tab, then renames its group until it has pushed `count` ops. */
async function otherDevicePushes(count: number): Promise<void> {
  const other = new MemoryStore('other');
  const g = (await other.transact((tx) => storeTabs(tx, [tab('a')], settings)))!;
  while (other.log.length < count) await other.transact((tx) => updateItem(tx, g, { title: `n${other.log.length}` }));
  const sealing = await importDataKey(dataKey);
  for (const op of other.log) server.receive('dev-other', op.opId, await sealOp(sealing, USER, op));
}

/** Another device stores tabs, pushes them, and uploads a snapshot that covers its whole log. */
async function otherDeviceSnapshots(names: string[]): Promise<void> {
  const other = new MemoryStore('other-snapshot');
  await other.transact((tx) => storeTabs(tx, names.map(tab), settings));
  const sealing = await importDataKey(dataKey);
  for (const op of other.log) server.receive('dev-other', op.opId, await sealOp(sealing, USER, op));
  const data = await sealSnapshot(sealing, USER, server.lastSeq, other.all());
  server.takeSnapshot({ seq: server.lastSeq, data: Buffer.from(data).toString('base64') });
}

describe('snapshots', () => {
  it('uploads none while the log is 4,999 ops past the last snapshot', async () => {
    await joinSync(account);
    await otherDevicePushes(4999);
    await syncOnce();
    expect(await db.meta.get('syncCursor')).toMatchObject({ value: 4999 });
    expect(server.snapshotPuts()).toEqual([]);
  });

  it('uploads what it holds at 5,000 ops, once, and again 5,000 ops later', async () => {
    await joinSync(account);
    await otherDevicePushes(5000);
    await syncOnce();
    await syncOnce();
    expect(server.snapshotPuts().length).toBe(1);
    expect(server.snapshot?.seq).toBe(5000);

    const key = await importDataKey(dataKey);
    const reader = new MemoryStore('reader');
    const records = await openSnapshot(key, USER, 5000, Buffer.from(server.snapshot!.data, 'base64'));
    await reader.transact((tx) => mergeRecords(tx, records));
    expect(await tabTitles(reader)).toEqual([['a']]);
    expect((await liveChildren(reader, null)).map((g) => g.title)).toEqual(['n4999']);

    await otherDevicePushes(4999);
    await syncOnce();
    expect(server.snapshotPuts().length).toBe(1);
    await otherDeviceStores(['b']);
    await syncOnce();
    expect(server.snapshotPuts().length).toBe(2);
    expect(server.snapshot?.seq).toBe(server.lastSeq);
  });

  it('reads the snapshot when its cursor is behind it, then pulls the ops after it', async () => {
    await otherDeviceSnapshots(['a', 'b']);
    await otherDeviceStores(['c']);
    await joinSync(account);
    await syncOnce();
    expect(await tabTitles(source)).toEqual([['a', 'b'], ['c']]);

    await otherDeviceStores(['d']);
    await syncOnce();
    expect(await tabTitles(source)).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('pushes nothing it read from a snapshot', async () => {
    await otherDeviceSnapshots(['a']);
    await joinSync(account);
    await syncOnce();
    expect(await tabTitles(source)).toEqual([['a']]);
    expect(server.pushes()).toEqual([]);
  });

  it('keeps the tabs a device holds when it reads a snapshot, and uploads them', async () => {
    await transact((tx) => storeTabs(tx, [tab('mine')], settings));
    await otherDeviceSnapshots(['a']);
    await joinSync(account);
    await syncOnce();
    expect(await tabTitles(source)).toEqual([['a'], ['mine']]);
    expect(await tabTitles(await replica())).toEqual([['mine']]);
  });

  it('ends the cycle without an error when another device uploaded a newer snapshot first, and does not try again', async () => {
    await joinSync(account);
    await otherDevicePushes(5000);
    server.snapshotRace = true;
    await sync();
    await sync();
    expect((await syncStatus())?.error).toBeUndefined();
    expect(server.snapshotPuts().length).toBe(1);
  });
});

describe('joinSync', () => {
  it('stores the account', async () => {
    await joinSync(account);
    expect(await syncAccount()).toEqual(account);
  });

  it('uploads one value per field, not the history of edits', async () => {
    const g = (await transact((tx) => storeTabs(tx, [tab('a')], settings)))!;
    for (const title of ['one', 'two', 'three']) await transact((tx) => updateItem(tx, g, { title }));
    const history = await db.outbox.count();
    await joinSync(account);
    const queued: Op[] = (await db.outbox.toArray()).map((row) => row.op);
    expect(queued.length).toBeLessThan(history);
    expect(queued.filter((op) => op.itemId === g && 'title' in op.fields).map((op) => op.fields.title)).toEqual([
      'three',
    ]);
  });

  it('keeps the tabs a device holds when it joins an account with tabs of its own, and after it leaves', async () => {
    await transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings));
    await otherDeviceStores(['c']);
    await joinSync(account);
    await syncOnce();
    expect(await tabTitles(source)).toEqual([['a', 'b'], ['c']]);
    expect(await tabTitles(await replica())).toEqual([['a', 'b'], ['c']]);

    await leaveSync();
    expect(await tabTitles(source)).toEqual([['a', 'b'], ['c']]);
  });
});

describe('sync status', () => {
  it('records the time of a cycle that succeeded, with no error', async () => {
    await joinSync(account);
    await transact((tx) => storeTabs(tx, [tab('a')], settings));
    const before = Date.now();
    await sync();
    const after = Date.now();
    const status = await syncStatus();
    expect(status).toEqual({ at: expect.any(Number) });
    expect(status!.at).toBeGreaterThanOrEqual(before);
    expect(status!.at).toBeLessThanOrEqual(after);
  });

  it('records signedOut when the server refuses the refresh token', async () => {
    await joinSync({ ...account, accessToken: 'stale', refreshToken: 'stale' });
    await sync();
    expect((await syncStatus())?.error).toBe('signedOut');
  });

  it('records failed when a push is answered 500', async () => {
    await joinSync(account);
    await transact((tx) => storeTabs(tx, [tab('a')], settings));
    server.pushStatus = 500;
    await sync();
    expect((await syncStatus())?.error).toBe('failed');
  });

  it('records nothing on a device that joined no account', async () => {
    await transact((tx) => storeTabs(tx, [tab('a')], settings));
    await sync();
    expect(await syncStatus()).toBeUndefined();
  });

  it('clears the status of an earlier account when the device joins again', async () => {
    await joinSync({ ...account, accessToken: 'stale', refreshToken: 'stale' });
    await sync();
    expect(await syncStatus()).toBeDefined();
    await joinSync(account);
    expect(await syncStatus()).toBeUndefined();
  });
});

describe('client', () => {
  const refreshes = () => server.calls.filter((c) => c.call === 'POST /v1/auth/refresh');

  it('retries with the tokens another context stored instead of refreshing again', async () => {
    await joinSync(account);
    const api = client(account);
    server.accessToken = 'access-other';
    server.refreshToken = 'refresh-other';
    await saveTokens({ accessToken: 'access-other', refreshToken: 'refresh-other' });

    const page = await api<{ ops: unknown[] }>('/v1/ops?after=0');

    expect(page.ops).toEqual([]);
    expect(refreshes()).toEqual([]);
    expect(server.calls.map((c) => c.call)).toEqual(['GET /v1/ops?after=0', 'GET /v1/ops?after=0']);
    expect(await syncAccount()).toMatchObject({ accessToken: 'access-other', refreshToken: 'refresh-other' });
  });

  it('refreshes once when the stored tokens are the ones the call used, and stores the new tokens', async () => {
    await joinSync(account);
    server.accessToken = 'access-expired-on-server';

    const page = await client(account)<{ ops: unknown[] }>('/v1/ops?after=0');

    expect(page.ops).toEqual([]);
    expect(refreshes()).toHaveLength(1);
    expect(await syncAccount()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });
});

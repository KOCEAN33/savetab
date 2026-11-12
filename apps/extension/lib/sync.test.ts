import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CryptoError,
  defaultSettings,
  importDataKey,
  liveChildren,
  MAX_SKEW_MS,
  MemoryStore,
  openOp,
  randomKey,
  sealOp,
  storeTabs,
  updateItem,
  type ItemSource,
  type Op,
} from '@savetab/core';
import { db, joinSync, source, syncAccount, transact, type SyncAccount } from './db';
import { SyncError, syncOnce } from './sync';

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
  now = () => Date.now();

  receive(deviceId: string, id: string, data: Uint8Array): void {
    if (this.log.some((row) => row.id === id)) return;
    this.log.push({
      seq: this.log.length + 1,
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
    return Response.json({ error: 'not_found' }, { status: 404 });
  };

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
});

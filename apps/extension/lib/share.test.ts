import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, ListView, openShare, storeTabs, type Group } from '@savetab/core';
import { db, joinSync, transact } from './db';
import { activeShare, shareItem, shareLink, stopSharing } from './share';
import { fromBase64, SyncError } from './sync';

const SERVER = 'https://sync.example';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The expiry the fake server answers, an RFC 3339 string as the /v2 contract writes it. */
const EXPIRES_AT = new Date(Date.now() + 30 * 86_400_000).toISOString();
const EXPIRES = Date.parse(EXPIRES_AT);
const settings = { ...defaultSettings, id: 'settings' };
const tab = (n: string) => ({ url: `https://${n}.example/`, title: n, favIconUrl: '' });

let calls: { call: string; body: string }[];
let deleteStatus: number;
/** The id the client sent in its last POST /v2/shares, which the fake echoes. */
let shareId: string;

function problem(status: number): Response {
  const kind = ({ 404: 'not-found', 500: 'internal' } as Record<number, string>)[status] ?? 'invalid';
  return new Response(JSON.stringify({ type: `/problems/${kind}`, title: kind, status, trace_id: 'trace-1' }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  calls = [];
  deleteStatus = 204;
  shareId = '';
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call = `${init.method ?? 'GET'} ${url.pathname}`;
    calls.push({ call, body: typeof init.body === 'string' ? init.body : '' });
    if (call === 'POST /v2/shares') {
      shareId = (JSON.parse(init.body as string) as { id: string }).id;
      return Response.json({ id: shareId, expires_at: EXPIRES_AT }, { status: 201 });
    }
    if (shareId && call === `DELETE /v2/shares/${shareId}`) {
      return deleteStatus === 204 ? new Response(null, { status: 204 }) : problem(deleteStatus);
    }
    return problem(500);
  });
});

afterEach(() => vi.unstubAllGlobals());

async function joinedGroup(): Promise<Group> {
  const id = (await transact((tx) => storeTabs(tx, [tab('a'), tab('b')], settings)))!;
  await joinSync({
    serverUrl: SERVER,
    userId: '0196f1c0-0000-7000-8000-000000000001',
    deviceId: 'dev-self',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    dataKey: new Uint8Array(32),
  });
  return current(id);
}

const current = async (id: string) => new ListView(await db.items.toArray()).get(id) as Group;

describe('shareLink', () => {
  it('opens the share at its view page with the key in the fragment', () => {
    expect(shareLink('https://sync.example', { id: '0190a000-0000-4000-8000-000000000001', key: 'a2V5', expiresAt: 1 })).toBe(
      'https://sync.example/v2/shares/0190a000-0000-4000-8000-000000000001/view#a2V5',
    );
  });
});

describe('shareItem', () => {
  it('uploads a blob that the key in the returned URL opens, and records the share on the group', async () => {
    const group = await joinedGroup();
    const url = new URL(await shareItem(new ListView(await db.items.toArray()), group));

    const sent = JSON.parse(calls.find((c) => c.call === 'POST /v2/shares')!.body) as { id: string; data: string };
    expect(sent.id).toMatch(UUID);
    expect(`${url.origin}${url.pathname}`).toBe(`${SERVER}/v2/shares/${sent.id}/view`);
    const keyText = url.hash.slice(1);
    expect(keyText).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const key = fromBase64(keyText.replaceAll('-', '+').replaceAll('_', '/'));
    expect(await openShare(key, fromBase64(sent.data))).toEqual({
      v: 1,
      title: '2 tabs',
      notes: '',
      items: [
        {
          kind: 'group',
          title: '2 tabs',
          notes: '',
          tabs: [
            { url: 'https://a.example/', title: 'a', notes: '' },
            { url: 'https://b.example/', title: 'b', notes: '' },
          ],
        },
      ],
    });

    const shared = await current(group.id);
    expect(shared.share).toEqual({ id: sent.id, key: keyText, expiresAt: EXPIRES });
    expect(shareLink(SERVER, shared.share!)).toBe(url.href);
  });

  it('rejects on a device with no account and uploads nothing', async () => {
    const id = (await transact((tx) => storeTabs(tx, [tab('a')], settings)))!;
    const group = await current(id);
    await expect(shareItem(new ListView(await db.items.toArray()), group)).rejects.toThrow('This device has no sync account');
    expect(calls).toEqual([]);
    expect((await current(id)).share ?? null).toBeNull();
  });
});

describe('stopSharing', () => {
  it('deletes the share on the server and clears it on the group', async () => {
    const group = await joinedGroup();
    await shareItem(new ListView(await db.items.toArray()), group);
    await stopSharing(await current(group.id));
    expect(shareId).toMatch(UUID);
    expect(calls.at(-1)?.call).toBe(`DELETE /v2/shares/${shareId}`);
    expect((await current(group.id)).share).toBeNull();
  });

  it('clears the share when the server no longer has it', async () => {
    const group = await joinedGroup();
    await shareItem(new ListView(await db.items.toArray()), group);
    deleteStatus = 404;
    await stopSharing(await current(group.id));
    expect(calls.at(-1)?.call).toBe(`DELETE /v2/shares/${shareId}`);
    expect((await current(group.id)).share).toBeNull();
  });

  it('keeps the share when the server fails', async () => {
    const group = await joinedGroup();
    await shareItem(new ListView(await db.items.toArray()), group);
    deleteStatus = 500;
    const error = await stopSharing(await current(group.id)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({ status: 500, type: '/problems/internal' });
    expect((await current(group.id)).share).toMatchObject({ id: shareId });
  });
});

describe('activeShare', () => {
  it('is the share until its expiry time, and nothing after it or without one', async () => {
    const share = { id: '0190a000-0000-4000-8000-0000000000aa', key: 'k', expiresAt: 2000 };
    const group = { ...(await joinedGroup()), share };
    expect(activeShare(group, 1999)).toEqual(share);
    expect(activeShare(group, 2000)).toBeUndefined();
    expect(activeShare({ ...group, share: null }, 0)).toBeUndefined();
  });
});

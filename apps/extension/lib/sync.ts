import { importDataKey, MAX_SKEW_MS, openOp, openSnapshot, sealOp, sealSnapshot, type RemoteOp } from '@savetab/core';
import {
  dropOutbox,
  mergePulled,
  mergeSnapshot,
  outboxHead,
  saveSnapshotSeq,
  saveSyncStatus,
  saveTokens,
  snapshotSeq,
  snapshotSource,
  syncAccount,
  syncCursor,
  type SyncAccount,
} from './db';

/** The server takes 500 ops and 8 MiB per push (plan P4, "HTTP API"). The byte cap leaves room for the JSON around the blobs. */
const PUSH_OPS = 500;
const PUSH_BYTES = 6 << 20;
/** A device uploads a snapshot once it has pulled this many ops past the last one (plan P4 step 7). */
const SNAPSHOT_OPS = 5000;

export const SYNC_ALARM = 'sync';

export class SyncError extends Error {
  constructor(
    readonly status: number,
    /** The `type` of the server's problem, such as `/problems/conflict`. */
    readonly type: string,
  ) {
    super(`The sync server answered ${status} ${type}`);
  }
}

/** The `Op` of `apps/server/api/openapi.yaml`. */
interface PulledOp {
  seq: number;
  id: string;
  device_id: string;
  data: string;
  received_at: string;
}

type Tokens = Pick<SyncAccount, 'accessToken' | 'refreshToken'>;
/** What a call needs to reach the server as one device. A device that has logged in but not joined has no data key yet. */
export type Login = Omit<SyncAccount, 'dataKey'>;

export const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function send(account: Pick<Login, 'serverUrl'>, path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  return fetch(account.serverUrl + path, { ...init, headers });
}

async function body<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;
  const problem = (await res.json().catch(() => ({}))) as { type?: string };
  throw new SyncError(res.status, problem.type ?? '');
}

/** Trade a login code or a refresh token for a device's tokens, by the grant `POST /v2/tokens` takes. */
export async function requestTokens(
  server: Pick<Login, 'serverUrl'>,
  grant: Record<string, string>,
): Promise<Omit<Login, 'serverUrl'>> {
  const init = { method: 'POST', body: JSON.stringify(grant) };
  const made = await body<{ access_token: string; refresh_token: string; user_id: string; device_id: string }>(
    await send(server, '/v2/tokens', init),
  );
  return {
    userId: made.user_id,
    deviceId: made.device_id,
    accessToken: made.access_token,
    refreshToken: made.refresh_token,
  };
}

/**
 * Replace tokens the server refused. The background and an open page both call the server, and a
 * refresh token works once, so the lock lets one of them refresh and the other read the result.
 */
function refresh(login: Login, used: Tokens): Promise<Tokens> {
  return navigator.locks.request('savetab-refresh', async () => {
    const stored = await syncAccount();
    if (stored && stored.refreshToken !== used.refreshToken) return stored;
    const { accessToken, refreshToken } = await requestTokens(login, {
      grant_type: 'refresh_token',
      refresh_token: used.refreshToken,
    });
    await saveTokens({ accessToken, refreshToken });
    return { accessToken, refreshToken };
  });
}

/** Calls to the server as one device. An access token the server refuses is replaced once, then the call repeats. */
export function client(login: Login) {
  let tokens: Tokens = login;
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    let res = await send(login, path, init, tokens.accessToken);
    if (res.status === 401) {
      tokens = await refresh(login, tokens);
      res = await send(login, path, init, tokens.accessToken);
    }
    return body<T>(res);
  };
}

type Call = ReturnType<typeof client>;

type Page = { ops: PulledOp[]; more: boolean; server_time: string };

/** Every item of a list the server pages by `next_page_token`. `field` is the response's array. */
export async function listAll<T>(call: Call, path: string, field: string): Promise<T[]> {
  const items: T[] = [];
  let token: string | undefined;
  do {
    const page = await call<Record<string, unknown>>(token ? `${path}?${new URLSearchParams({ page_token: token })}` : path);
    items.push(...(page[field] as T[]));
    token = page.next_page_token as string | undefined;
  } while (token);
  return items;
}

/** Read the server's snapshot, merge it, and return its `seq`, where the pull goes on. */
async function readSnapshot(call: Call, account: SyncAccount, key: CryptoKey): Promise<number> {
  const { seq, data } = await call<{ seq: number; data: string }>('/v2/snapshot');
  await mergeSnapshot(await openSnapshot(key, account.userId, seq, fromBase64(data)), seq);
  return seq;
}

/**
 * Pull and merge every op after the cursor. Returns the server's time in ms. When the server has
 * dropped ops above the cursor, which it answers 409, the snapshot that covers them is merged first.
 */
async function pull(call: Call, account: SyncAccount, key: CryptoKey): Promise<number> {
  let after = await syncCursor();
  for (;;) {
    let page: Page;
    try {
      page = await call<Page>(`/v2/ops?after=${after}`);
    } catch (err) {
      if (!(err instanceof SyncError && err.status === 409)) throw err;
      after = await readSnapshot(call, account, key);
      continue;
    }
    const remote: RemoteOp[] = [];
    for (const row of page.ops) {
      if (row.device_id === account.deviceId) continue;
      remote.push({ op: await openOp(key, account.userId, row.id, fromBase64(row.data)), receivedAt: Date.parse(row.received_at) });
    }
    const last = page.ops.at(-1);
    if (last) {
      after = last.seq;
      await mergePulled(remote, after);
    }
    if (!page.more) return Date.parse(page.server_time);
  }
}

// Ceiling: one op whose blob passes the server's 8 MiB limit is refused on every push and holds
// the outbox behind it. Split such a field or raise the limit if notes ever grow that large.
async function push(call: Call, account: SyncAccount, key: CryptoKey): Promise<void> {
  for (;;) {
    const ops: { id: string; data: string }[] = [];
    let bytes = 0;
    let sent: number | undefined;
    for (const row of await outboxHead(PUSH_OPS)) {
      const data = toBase64(await sealOp(key, account.userId, row.op));
      if (ops.length > 0 && bytes + data.length > PUSH_BYTES) break;
      ops.push({ id: row.op.opId, data });
      bytes += data.length;
      sent = row.seq;
    }
    if (sent === undefined) return;
    await call('/v2/ops', { method: 'POST', body: JSON.stringify({ ops }) });
    await dropOutbox(sent);
  }
}

// Ceiling: a snapshot is one JSON body of every record, and the server takes 64 MiB. Each device
// also counts from the last snapshot it saw itself, so two devices can upload the same one.
async function uploadSnapshot(call: Call, account: SyncAccount, key: CryptoKey): Promise<void> {
  if ((await syncCursor()) - (await snapshotSeq()) < SNAPSHOT_OPS) return;
  const { seq, records } = await snapshotSource();
  const data = toBase64(await sealSnapshot(key, account.userId, seq, records));
  try {
    await call('/v2/snapshot', { method: 'PUT', body: JSON.stringify({ seq, data }) });
  } catch (err) {
    // 409: another device's snapshot already covers these ops.
    if (!(err instanceof SyncError && err.status === 409)) throw err;
  }
  await saveSnapshotSeq(seq);
}

/** One sync cycle: pull and merge, push the outbox, then upload a snapshot when one is due. It rejects when a step fails, and the next cycle repeats that step. */
export async function syncOnce(): Promise<void> {
  const account = await syncAccount();
  if (!account) return;
  const call = client(account);
  const key = await importDataKey(account.dataKey);
  const serverTime = await pull(call, account, key);
  // Every device skips an op whose clock runs this far ahead of the server's (`mergeRemote`).
  if (Date.now() > serverTime + MAX_SKEW_MS) return;
  await push(call, account, key);
  await uploadSnapshot(call, account, key);
}

let running: Promise<void> | undefined;
let queued: Promise<void> | undefined;

/** Run a cycle now, or one more after the cycle in flight. Cycles never overlap, since a refresh token works once. */
export function sync(): Promise<void> {
  if (running) {
    queued ??= running.then(() => {
      queued = undefined;
      return sync();
    });
    return queued;
  }
  running = syncOnce()
    .then(
      () => saveSyncStatus({ at: Date.now() }),
      (err: unknown) => {
        console.warn('sync failed', err);
        const at = Date.now();
        if (err instanceof SyncError) {
          return saveSyncStatus({ at, error: err.status === 401 ? 'signedOut' : 'failed', status: err.status });
        }
        // fetch rejects with a TypeError when the request got no answer.
        return saveSyncStatus({ at, error: err instanceof TypeError ? 'unreachable' : 'failed' });
      },
    )
    .finally(() => {
      running = undefined;
    });
  return running;
}

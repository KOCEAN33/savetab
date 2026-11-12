import { importDataKey, MAX_SKEW_MS, openOp, sealOp, type RemoteOp } from '@savetab/core';
import {
  dropOutbox,
  mergePulled,
  outboxHead,
  saveSyncStatus,
  saveTokens,
  syncAccount,
  syncCursor,
  type SyncAccount,
} from './db';

/** The server takes 500 ops and 8 MiB per push (plan P4, "HTTP API"). The byte cap leaves room for the JSON around the blobs. */
const PUSH_OPS = 500;
const PUSH_BYTES = 6 << 20;

export const SYNC_ALARM = 'sync';

export class SyncError extends Error {
  constructor(
    readonly status: number,
    /** The server's error code, such as `snapshot_required`. */
    readonly code: string,
  ) {
    super(`The sync server answered ${status} ${code}`);
  }
}

interface PulledOp {
  seq: number;
  id: string;
  deviceId: string;
  data: string;
  receivedAt: number;
}

type Tokens = Pick<SyncAccount, 'accessToken' | 'refreshToken'>;
/** What a call needs to reach the server as one device. A device that has logged in but not joined has no data key yet. */
export type Login = Omit<SyncAccount, 'dataKey'>;

export const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function send(account: Pick<Login, 'serverUrl'>, path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  return fetch(account.serverUrl + path, { ...init, headers });
}

export async function body<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;
  const answer = (await res.json().catch(() => ({}))) as { error?: string };
  throw new SyncError(res.status, answer.error ?? '');
}

/**
 * Replace tokens the server refused. The background and an open page both call the server, and a
 * refresh token works once, so the lock lets one of them refresh and the other read the result.
 */
function refresh(login: Login, used: Tokens): Promise<Tokens> {
  return navigator.locks.request('savetab-refresh', async () => {
    const stored = await syncAccount();
    if (stored && stored.refreshToken !== used.refreshToken) return stored;
    const init = { method: 'POST', body: JSON.stringify({ refreshToken: used.refreshToken }) };
    const tokens = await body<Tokens>(await send(login, '/v1/auth/refresh', init));
    await saveTokens(tokens);
    return tokens;
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

/** Pull and merge every op after the cursor. Returns the server's time. */
async function pull(call: Call, account: SyncAccount, key: CryptoKey): Promise<number> {
  let after = await syncCursor();
  for (;;) {
    const page = await call<{ ops: PulledOp[]; more: boolean; serverTime: number }>(`/v1/ops?after=${after}`);
    const remote: RemoteOp[] = [];
    for (const row of page.ops) {
      if (row.deviceId === account.deviceId) continue;
      remote.push({ op: await openOp(key, account.userId, row.id, fromBase64(row.data)), receivedAt: row.receivedAt });
    }
    const last = page.ops.at(-1);
    if (last) {
      after = last.seq;
      await mergePulled(remote, after);
    }
    if (!page.more) return page.serverTime;
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
    await call('/v1/ops', { method: 'POST', body: JSON.stringify({ ops }) });
    await dropOutbox(sent);
  }
}

/** One sync cycle: pull and merge, then push the outbox. It rejects when a step fails, and the next cycle repeats that step. */
export async function syncOnce(): Promise<void> {
  const account = await syncAccount();
  if (!account) return;
  const call = client(account);
  const key = await importDataKey(account.dataKey);
  const serverTime = await pull(call, account, key);
  // Every device skips an op whose clock runs this far ahead of the server's (`mergeRemote`).
  if (Date.now() > serverTime + MAX_SKEW_MS) return;
  await push(call, account, key);
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
        const signedOut = err instanceof SyncError && err.status === 401;
        return saveSyncStatus({ at: Date.now(), error: signedOut ? 'signedOut' : 'failed' });
      },
    )
    .finally(() => {
      running = undefined;
    });
  return running;
}

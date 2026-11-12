import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { defaultSettings, importDataKey, MemoryStore, sealOp, storeTabs, updateItem } from '@savetab/core';

const SERVER_SCRIPT = path.resolve(import.meta.dirname, '../../server/scripts/e2e-server.sh');
/** Where a login ends. No browser opens it here: the test reads the code from the redirect. */
const REDIRECT = 'https://savetab-e2e.chromiumapp.org/';

/** What `joinSync` takes, less the data key. */
export interface Login {
  serverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Start the sync server of apps/server on a database of its own, with an issuer that logs everyone
 * in as one user. `redirects` are the extension redirect URIs a login window may end at.
 */
export async function startSyncServer(redirects: string[] = []): Promise<{ url: string; stop: () => Promise<void> }> {
  const proc = spawn(SERVER_SCRIPT, {
    env: { ...process.env, AUTH_REDIRECT_URIS: [REDIRECT, ...redirects].join(' ') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(proc, 'exit');
  const [url] = await Promise.race([
    once(createInterface(proc.stdout), 'line') as Promise<string[]>,
    exited.then(() => Promise.reject(new Error('the sync server stopped before it printed its URL'))),
  ]);
  return {
    url: url!,
    stop: async () => {
      proc.kill('SIGTERM');
      await exited;
    },
  };
}

/** Log in the way the extension's login window does, and return the device's account. */
export async function logIn(server: string, deviceName: string): Promise<Login> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let url = `${server}/v1/auth/start?${new URLSearchParams({ redirect_uri: REDIRECT, code_challenge: challenge, state: 'e2e' })}`;
  while (!url.startsWith(REDIRECT)) {
    const res = await fetch(url, { redirect: 'manual' });
    const next = res.headers.get('location');
    if (!next) throw new Error(`login stopped at ${url} with status ${res.status}`);
    url = next;
  }
  const res = await fetch(`${server}/v1/auth/token`, {
    method: 'POST',
    body: JSON.stringify({ code: new URL(url).searchParams.get('code'), codeVerifier: verifier, deviceName }),
  });
  if (!res.ok) throw new Error(`token: status ${res.status}`);
  const { accessToken, refreshToken, userId, deviceId } = (await res.json()) as Omit<Login, 'serverUrl'>;
  return { serverUrl: server, userId, deviceId, accessToken, refreshToken };
}

/**
 * Push `count` ops as the device of `login`: one group with one tab titled `title`, then renames
 * of that group.
 */
export async function pushOps(login: Login, dataKey: number[], title: string, count: number): Promise<void> {
  const store = new MemoryStore('e2e');
  const tab = { url: 'https://pushed.example/', title, favIconUrl: '' };
  const group = (await store.transact((tx) => storeTabs(tx, [tab], { ...defaultSettings, id: 'settings' })))!;
  while (store.log.length < count) await store.transact((tx) => updateItem(tx, group, { title: `n${store.log.length}` }));
  const key = await importDataKey(new Uint8Array(dataKey));
  for (let at = 0; at < count; at += 500) {
    const ops = await Promise.all(
      store.log.slice(at, at + 500).map(async (op) => ({
        id: op.opId,
        data: Buffer.from(await sealOp(key, login.userId, op)).toString('base64'),
      })),
    );
    const res = await fetch(`${login.serverUrl}/v1/ops`, {
      method: 'POST',
      headers: { authorization: `Bearer ${login.accessToken}` },
      body: JSON.stringify({ ops }),
    });
    if (!res.ok) throw new Error(`push: status ${res.status}`);
  }
}

/** The `seq` of the user's snapshot on the server, or 0 when it holds none. */
export async function snapshotSeq(login: Login): Promise<number> {
  const res = await fetch(`${login.serverUrl}/v1/snapshot`, { headers: { authorization: `Bearer ${login.accessToken}` } });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`snapshot: status ${res.status}`);
  return ((await res.json()) as { seq: number }).seq;
}

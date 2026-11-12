import type { BrowserContext, Page, Worker } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test as base, expect, launchProfile, openPages, sendWindow, workerOf } from './fixtures';

const SERVER_SCRIPT = path.resolve(import.meta.dirname, '../../server/scripts/e2e-server.sh');
/** Where a login ends. No browser opens it here: the test reads the code from the redirect. */
const REDIRECT = 'https://savetab-e2e.chromiumapp.org/';

interface Profile {
  context: BrowserContext;
  worker: Worker;
  list: Page;
}

async function profile(context: BrowserContext): Promise<Profile> {
  const worker = await workerOf(context);
  const list = await context.newPage();
  await list.goto(`chrome-extension://${new URL(worker.url()).host}/onetab.html`);
  return { context, worker, list };
}

const test = base.extend<{ first: Profile; second: Profile; server: string; dataKey: number[] }>({
  first: async ({ context }, use) => {
    await use(await profile(context));
  },
  // oxlint-disable-next-line no-empty-pattern
  second: async ({}, use) => {
    const context = await launchProfile();
    await use(await profile(context));
    await context.close();
  },
  // The sync server of apps/server on a database of its own, with an issuer that logs everyone in as one user.
  server: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const proc = spawn(SERVER_SCRIPT, {
        env: { ...process.env, AUTH_REDIRECT_URIS: REDIRECT },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      const exited = once(proc, 'exit');
      const [url] = await Promise.race([
        once(createInterface(proc.stdout), 'line') as Promise<string[]>,
        exited.then(() => Promise.reject(new Error('the sync server stopped before it printed its URL'))),
      ]);
      await use(url!);
      proc.kill('SIGTERM');
      await exited;
    },
    { timeout: 120_000 },
  ],
  // oxlint-disable-next-line no-empty-pattern
  dataKey: async ({}, use) => {
    await use([...randomBytes(32)]);
  },
});

/** Log in the way the extension's login window does, and return the device's tokens. */
async function logIn(server: string, deviceName: string) {
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
  return (await res.json()) as { accessToken: string; refreshToken: string; userId: string; deviceId: string };
}

async function join(p: Profile, server: string, dataKey: number[], deviceName: string): Promise<void> {
  const { accessToken, refreshToken, userId, deviceId } = await logIn(server, deviceName);
  await p.worker.evaluate(
    ({ account, key }) => (globalThis as any).savetabTest.joinSync({ ...account, dataKey: new Uint8Array(key) }),
    { account: { serverUrl: server, userId, deviceId, accessToken, refreshToken }, key: dataKey },
  );
}

/** Wait until the profile's list shows exactly `titles`. Each try runs a cycle, since the alarm that pulls fires once a minute. */
async function expectTabs(p: Profile, titles: string[]): Promise<void> {
  await expect(async () => {
    await p.worker.evaluate(() => (globalThis as any).savetabTest.sync());
    await expect(p.list.locator('.tab-link')).toHaveText(titles, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

test('a tab stored in one profile shows in the other', async ({ first, second, server, dataKey }) => {
  await join(first, server, dataKey, 'first');
  await join(second, server, dataKey, 'second');

  await openPages(first.context, ['shared']);
  await sendWindow(first.worker);

  await expectTabs(second, ['Page shared']);
});

test('a device that joins uploads the tabs it already holds', async ({ first, second, server, dataKey }) => {
  await openPages(second.context, ['mine']);
  await sendWindow(second.worker);
  await expect(second.list.locator('.tab-link')).toHaveText(['Page mine']);

  await join(first, server, dataKey, 'first');
  await join(second, server, dataKey, 'second');

  await expectTabs(first, ['Page mine']);
});

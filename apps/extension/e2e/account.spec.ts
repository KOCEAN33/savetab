import type { Page } from '@playwright/test';
import { openPages, sendWindow } from './fixtures';
import { expect, expectTabs, test, type Profile } from './sync-fixtures';

/** Crockford base32 in 13 groups of 4 (plan P4, "Formats"). */
const RECOVERY_KEY = /^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/;

/** Open the profile's sync page and sign in. The e2e server's issuer logs every visitor in as one user. */
async function signIn(p: Profile, server: string, deviceName: string): Promise<Page> {
  await p.worker.evaluate((url) => chrome.storage.local.set({ e2eSyncServer: url }), server);
  const page = await p.context.newPage();
  await page.goto(`chrome-extension://${new URL(p.worker.url()).host}/account.html`);
  await page.getByLabel('Device name').fill(deviceName);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

/** Sign in as the account's first device and return its page and the recovery key it shows. */
async function setUp(p: Profile, server: string): Promise<{ page: Page; recoveryKey: string }> {
  const page = await signIn(p, server, 'first');
  const shown = page.locator('.recovery-key');
  await expect(shown).toHaveText(RECOVERY_KEY);
  return { page, recoveryKey: await shown.innerText() };
}

test('the first device shows its recovery key once, and a second device joins with it', async ({
  first,
  second,
  server,
}) => {
  const { page, recoveryKey } = await setUp(first, server);
  await page.getByRole('button', { name: 'I saved it' }).click();
  await expect(page.getByText(recoveryKey)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible();
  await expect(page.getByText(recoveryKey)).toHaveCount(0);

  const other = await signIn(second, server, 'second');
  await other.getByLabel('Recovery key').fill(recoveryKey.toLowerCase().replaceAll('-', ' '));
  await other.getByRole('button', { name: 'Join' }).click();
  await expect(other.locator('.device')).toHaveText([/^first/, /^second.*This device$/]);

  await openPages(first.context, ['shared']);
  await sendWindow(first.worker);
  await expectTabs(second, ['Page shared']);
});

test('a recovery key of another account does not join', async ({ first, second, server }) => {
  const { recoveryKey } = await setUp(first, server);
  const wrong = Array(13).fill('0000').join('-');
  expect(wrong).not.toBe(recoveryKey);

  const other = await signIn(second, server, 'second');
  await other.getByLabel('Recovery key').fill(wrong);
  await other.getByRole('button', { name: 'Join' }).click();

  await expect(other.getByRole('alert')).toHaveText('That recovery key does not open this account.');
  await expect(other.getByLabel('Recovery key')).toBeVisible();
});

test('a device joins by comparing a pairing code with a signed-in device', async ({ first, second, server }) => {
  const { page } = await setUp(first, server);
  const other = await signIn(second, server, 'second');
  await other.getByRole('button', { name: 'Pair with a signed-in device' }).click();

  await page.locator('.device', { hasText: 'second' }).getByRole('button', { name: 'Pair' }).click();
  await expect(page.locator('.pair-code')).toHaveText(/^\d{6}$/);
  await expect(other.locator('.pair-code')).toHaveText(await page.locator('.pair-code').innerText());
  await other.getByRole('button', { name: 'The codes match' }).click();
  await page.getByRole('button', { name: 'The codes match' }).click();
  await expect(other.locator('.device')).toHaveText([/^first/, /^second.*This device$/]);

  await openPages(first.context, ['paired']);
  await sendWindow(first.worker);
  await expectTabs(second, ['Page paired']);
});

test('removing a device signs it out, and signing out leaves the account', async ({ first, second, server }) => {
  const { page, recoveryKey } = await setUp(first, server);
  const other = await signIn(second, server, 'second');
  await other.getByLabel('Recovery key').fill(recoveryKey);
  await other.getByRole('button', { name: 'Join' }).click();
  await expect(other.locator('.device')).toHaveCount(2);

  await page.locator('.device', { hasText: 'second' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.device')).toHaveText([/^first.*This device$/]);
  await expect(async () => {
    await second.worker.evaluate(() => (globalThis as any).savetabTest.sync());
    await expect(other.getByRole('status')).toHaveText(/The server signed this device out/, { timeout: 500 });
  }).toPass({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

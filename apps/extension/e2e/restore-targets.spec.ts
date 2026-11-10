import type { BrowserContext, Worker } from '@playwright/test';
import { expect, onetabPage, openPages, sendWindow, SITE, test } from './fixtures';

const windowCount = (worker: Worker) => worker.evaluate(async () => (await chrome.windows.getAll()).length);

/** Check option radios, then wait until the settings record holds `saved`. Closing the page earlier aborts the write. */
async function chooseOptions(
  context: BrowserContext,
  extensionId: string,
  labels: string[],
  saved: Record<string, unknown>,
) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  for (const label of labels) await options.getByRole('radio', { name: label }).check();
  const read = () =>
    options.evaluate(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          const open = indexedDB.open('savetab');
          open.onsuccess = () => {
            const get = open.result.transaction('items').objectStore('items').get('settings');
            get.onsuccess = () => resolve(get.result ?? {});
          };
        }),
    );
  await expect.poll(read).toMatchObject(saved);
  await options.close();
}

test('"Restore in a new window" sticks to the group until "Use default restore"', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['w1', 'w2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await chooseOptions(context, extensionId, [
    'Open the tabs in the current window',
    'Keep them in your list (hold Alt/Option to mark them archived)',
  ], { restoreGroupTarget: 'current', afterRestore: 'keep' });
  await list.bringToFront();
  expect(await windowCount(worker)).toBe(1);

  const group = list.locator('.group').first();
  await group.getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Restore in a new window' }).click();
  await expect.poll(() => windowCount(worker)).toBe(2);

  await list.bringToFront();
  await group.getByRole('button', { name: 'Restore all' }).click();
  await expect.poll(() => windowCount(worker)).toBe(3);

  await group.getByRole('button', { name: 'More…' }).click();
  await list.getByRole('menuitem', { name: 'Use default restore' }).click();
  await group.getByRole('button', { name: 'Restore all' }).click();
  await expect.poll(() => list.context().pages().filter((p) => p.url() === `${SITE}/w1`).length).toBe(3);
  expect(await windowCount(worker)).toBe(3);
});

test('a URL the browser refuses opens the placeholder page and stays listed', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/import-export.html`);
  await page.getByRole('textbox', { name: 'Links to import' }).fill('chrome://crash | Crash page');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('status').first()).toHaveText('Imported 1 tab in 1 group.');
  await page.goto(`chrome-extension://${extensionId}/onetab.html`);

  const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/placeholder.html') });
  await page.getByRole('link', { name: 'Crash page' }).click();
  const placeholder = await opened;
  await expect(placeholder.getByRole('textbox', { name: 'Address' })).toHaveValue('chrome://crash/');
  await expect(page.getByRole('link', { name: 'Crash page' })).toBeVisible();
});

test('with "Discard tabs on open", a restored group opens its tabs unloaded with their URLs', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['u1', 'u2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await chooseOptions(context, extensionId, [
    'Open the tabs in the current window',
    'Discard tabs on open (each tab loads when you switch to it)',
  ], { restoreGroupTarget: 'current', discardOnOpen: true });
  await list.bringToFront();

  await list.locator('.group').first().getByRole('button', { name: 'Restore all' }).click();
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.tabs.query({ discarded: true })).map((t) => t.url ?? t.pendingUrl).sort(),
      ),
    )
    .toEqual([`${SITE}/u1`, `${SITE}/u2`]);
});

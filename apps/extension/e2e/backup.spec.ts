import { expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('a list lost from IndexedDB comes back from the backup when the background restarts', async ({
  context,
  worker,
  extensionId,
}) => {
  await openPages(context, ['b1', 'b2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  await expect(list.locator('.tab-link')).toHaveText(['Page b1', 'Page b2']);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByText('No backup yet.', { exact: false })).toBeVisible();
  await options.getByRole('button', { name: 'Back up now' }).click();
  await expect(options.getByText('Last backup:', { exact: false })).toBeVisible();

  await options.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('savetab');
        open.onsuccess = () => {
          const tx = open.result.transaction('items', 'readwrite');
          tx.objectStore('items').clear();
          tx.oncomplete = () => resolve();
        };
      }),
  );

  // An open list page would show the restore message instead of the page opened below.
  await list.close();
  await options.close();

  // Stop the background worker. Opening a tab wakes it, and the data-loss check runs on start.
  // chrome.runtime.reload() would unload an extension loaded with --load-extension.
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extensionId))!;
  await cdp.send('Target.closeTarget', { targetId: sw.targetId });
  await expect.poll(async () => (await cdp.send('Target.getTargets')).targetInfos.some((t) => t.targetId === sw.targetId)).toBe(false);

  const page = await context.newPage();
  await expect(async () => {
    await page.goto(`chrome-extension://${extensionId}/onetab.html`);
    await expect(page.locator('.tab-link')).toHaveCount(2, { timeout: 1000 });
  }).toPass();
  await expect(page.getByText('Your list was restored from the backup of', { exact: false })).toBeVisible();
  await expect(page.locator('.tab-link')).toHaveText(['Page b1', 'Page b2']);
});

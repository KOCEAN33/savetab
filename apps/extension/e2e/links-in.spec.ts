import { expect, test } from './fixtures';

test('a rich text paste on the import page becomes "URL | Title" lines', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/import-export.html`);
  const box = page.getByRole('textbox', { name: 'Links to import' });
  await box.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', '<p>Read <a href="https://a.example/">Alpha  post</a> and <a href="https://b.example/x">Beta</a></p>');
    data.setData('text/plain', 'Read Alpha post and Beta');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(box).toHaveValue('https://a.example/ | Alpha post\nhttps://b.example/x | Beta');
});

test('a chosen bookmark folder imports as a folder with its bookmarks as a group', async ({
  context,
  worker,
  extensionId,
}) => {
  await worker.evaluate(async () => {
    const dev = await chrome.bookmarks.create({ parentId: '1', title: 'Dev' });
    await chrome.bookmarks.create({ parentId: dev.id, title: 'WXT', url: 'https://wxt.dev/' });
    await chrome.bookmarks.create({ parentId: dev.id, title: 'Svelte', url: 'https://svelte.dev/' });
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/import-export.html`);
  await page.getByRole('button', { name: 'Import bookmarks' }).click();
  await page.getByRole('checkbox', { name: 'Dev' }).check();
  await page.getByRole('button', { name: 'Import chosen folders' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 1 folder.' })).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/onetab.html`);
  await page.getByRole('main').getByRole('button', { name: 'Dev', exact: true }).click();
  await expect(page.locator('.tab-link')).toHaveText(['WXT', 'Svelte']);
});

test('links dropped on the list page become a new group', async ({ context, extensionId }) => {
  const list = await context.newPage();
  await list.goto(`chrome-extension://${extensionId}/onetab.html`);
  await list.locator('main').evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/uri-list', 'https://drop.example/a\r\nhttps://drop.example/b');
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(list.locator('.tab-link')).toHaveText(['https://drop.example/a', 'https://drop.example/b']);
});

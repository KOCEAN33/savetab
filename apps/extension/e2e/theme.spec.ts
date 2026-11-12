import { expect, onetabPage, openPages, sendWindow, test } from './fixtures';

test('the header theme button switches the list page to the dark palette', async ({ context, worker, extensionId }) => {
  await openPages(context, ['d1']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  // The body paints --color-surface. Its computed value is rgb(), which the CSS minifier cannot shorten.
  const surface = () => list.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await list.getByRole('button', { name: 'Theme: Automatic' }).click();
  await list.getByRole('button', { name: 'Theme: Light' }).click();
  await expect(list.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();
  // DESIGN.md dark-surface #17181b.
  expect(await surface()).toBe('rgb(23, 24, 27)');

  await list.getByRole('button', { name: 'Theme: Dark' }).click();
  await expect(list.getByRole('button', { name: 'Theme: Automatic' })).toBeVisible();
  expect(await surface()).toBe('rgb(255, 255, 255)');
});

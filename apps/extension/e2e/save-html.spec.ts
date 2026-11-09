import { readFile } from 'node:fs/promises';
import { expect, onetabPage, openPages, sendWindow, SITE, test } from './fixtures';

test('"Save as HTML file" downloads the group as a page of links', async ({ context, worker, extensionId }) => {
  await openPages(context, ['h1', 'h2']);
  await sendWindow(worker);
  const list = await onetabPage(context, extensionId);
  const group = list.locator('.group').first();
  await group.getByRole('button', { name: '2 tabs', exact: true }).click();
  await list.locator('.group-title-input').fill('Reading: week 1');
  await list.keyboard.press('Enter');

  await group.getByRole('button', { name: 'More…' }).click();
  const download = list.waitForEvent('download');
  await list.getByRole('menuitem', { name: 'Save as HTML file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Reading_ week 1.html');

  const html = await readFile((await file.path())!, 'utf8');
  expect([...html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])).toEqual([
    [`${SITE}/h1`, 'Page h1'],
    [`${SITE}/h2`, 'Page h2'],
  ]);
  expect(html).toContain('<h1>Reading: week 1</h1>');
});

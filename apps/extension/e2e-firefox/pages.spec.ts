import { By } from 'selenium-webdriver';
import { EXT, expect, find, test, texts } from './fixtures';

test('an options choice persists across a reload', async ({ ff: { driver } }) => {
  await driver.get(`${EXT}/options.html`);
  const full = () => driver.findElement(By.xpath(`//label[normalize-space()='Full']/input`));
  await expect.poll(async () => (await full()).isSelected()).toBe(false);

  await (await full()).click();
  await expect.poll(async () => (await full()).isSelected()).toBe(true);
  await driver.navigate().refresh();
  await expect.poll(async () => (await full()).isSelected()).toBe(true);
});

test('imports "URL | Title" text and exports it back', async ({ ff: { driver } }) => {
  await driver.get(`${EXT}/import-export.html`);
  const text = 'https://a.example/ | A\nhttps://b.example/\n\nhttps://c.example/ | C\n';
  await (await find(driver, By.css('textarea[aria-label="Links to import"]'))).sendKeys(text);
  await (await find(driver, By.xpath(`//button[normalize-space()='Import']`))).click();

  const status = await find(driver, By.css('[role="status"]'));
  await expect.poll(() => status.getText()).toBe('Imported 3 tabs in 2 groups.');
  const exported = await find(driver, By.css('textarea[aria-label="Exported links"]'));
  await expect.poll(() => exported.getAttribute('value')).toBe(text);
});

test('on the list page a margin rectangle ticks rows and Delete all trashes a group', async ({ ff: { driver } }) => {
  await driver.get(`${EXT}/import-export.html`);
  const text = 'https://m1.example/ | M1\nhttps://m2.example/ | M2\nhttps://m3.example/ | M3\n\nhttps://z.example/ | Z';
  const input = await find(driver, By.css('textarea[aria-label="Links to import"]'));
  await input.sendKeys(text);
  await expect.poll(() => input.getAttribute('value')).toBe(text);
  await (await find(driver, By.xpath(`//button[normalize-space()='Import']`))).click();
  const status = await find(driver, By.css('[role="status"]'));
  await expect.poll(() => status.getText()).toBe('Imported 4 tabs in 2 groups.');

  await driver.get(`${EXT}/onetab.html`);
  await find(driver, By.css('main .tab'));
  const rows = await driver.findElements(By.css('main .tab'));
  const first = await rows[0]!.getRect();
  const second = await rows[1]!.getRect();
  await driver
    .actions()
    .move({ x: Math.round(first.x - 60), y: Math.round(first.y + 4) })
    .press()
    .move({ x: Math.round(first.x + 100), y: Math.round(second.y + second.height / 2), duration: 200 })
    .release()
    .perform();
  const checked = () => driver.executeScript<string[]>(() =>
    [...document.querySelectorAll<HTMLInputElement>('main input[type="checkbox"]:checked')].map((i) => i.ariaLabel!),
  );
  await expect.poll(checked).toEqual(['Select M1', 'Select M2']);

  const head = await find(driver, By.css('main .group-head'));
  await driver.actions().move({ origin: head }).perform();
  await (await head.findElement(By.xpath(`.//button[normalize-space()='Delete all']`))).click();
  await expect.poll(() => texts(driver, 'main .tab-link')).toEqual(['Z']);
});

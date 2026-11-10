import { By } from 'selenium-webdriver';
import { EXT, expect, test } from './fixtures';

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
  await driver.findElement(By.css('textarea[aria-label="Links to import"]')).sendKeys(text);
  await driver.findElement(By.xpath(`//button[normalize-space()='Import']`)).click();

  const status = driver.findElement(By.css('[role="status"]'));
  await expect.poll(() => status.getText()).toBe('Imported 3 tabs in 2 groups.');
  const exported = driver.findElement(By.css('textarea[aria-label="Exported links"]'));
  await expect.poll(() => exported.getAttribute('value')).toBe(text);
});

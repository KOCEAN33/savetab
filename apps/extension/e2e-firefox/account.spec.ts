import { By } from 'selenium-webdriver';
import { evaluate, EXT, expect, find, openPages, sendWindow, texts, type Firefox } from './fixtures';
import { expectTabs, test } from './sync-fixtures';

/** Crockford base32 in 13 groups of 4 (plan P4, "Formats"). */
const RECOVERY_KEY = /^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/;

const field = (label: string) => By.xpath(`//label[contains(normalize-space(.), '${label}')]/input`);
const button = (name: string) => By.xpath(`//button[normalize-space()='${name}']`);

/** Open the profile's sync page in its site window and sign in. The e2e server's issuer logs every visitor in as one user. */
async function signIn(ff: Firefox, server: string, deviceName: string): Promise<void> {
  const { driver } = ff;
  await evaluate(ff, (url: string) => browser.storage.local.set({ e2eSyncServer: url }), server);
  await driver.get(`${EXT}/account.html`);
  const name = await find(driver, field('Device name'));
  await name.clear();
  await name.sendKeys(deviceName);
  await (await find(driver, button('Sign in'))).click();
}

test('the first device shows its recovery key, and a second device joins with it', async ({ ff: first, second, server }) => {
  await signIn(first, server, 'first');
  const shown = await find(first.driver, By.css('code.recovery-key'));
  const recoveryKey = await shown.getText();
  expect(recoveryKey).toMatch(RECOVERY_KEY);

  await signIn(second, server, 'second');
  await (await find(second.driver, field('Recovery key'))).sendKeys(recoveryKey);
  await (await find(second.driver, button('Join'))).click();
  await expect.poll(() => texts(second.driver, '.device span:first-child')).toEqual(['first', 'second']);

  await second.driver.get(`${EXT}/onetab.html`);
  await openPages(first, ['shared']);
  await sendWindow(first);
  await expectTabs(second, ['Page shared']);
});

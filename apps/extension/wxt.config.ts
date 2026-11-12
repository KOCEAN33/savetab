import { defineConfig } from 'wxt';

/**
 * Fixes the Chrome extension id of the GitHub Releases build at mjkkpkbgjflhjgdkhhnejpjcdkfcpmkb, so its
 * sign-in redirect `https://<id>.chromiumapp.org/` is the same on every install and the sync server can list it.
 * Without it an unpacked install takes its id from its folder path. The Chrome Web Store rejects the field.
 */
const CHROME_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxpI3AHAnY8KNj1bL0XiaDHYfPo35rawGfQ4ZHCDlXZty8lO2mV7+NAo7ArEnBkGXa9ActxsL6X5pX4jsAKmPGPaai2+caEgWXEra/C1KeSV8QzzTNN7SXPjoFh7xwoQApLiGt9PQtLZ3JNtRGdmYftCT4xy7opx3uvuxS1afsRmqIgY8YIl1P8zpu5L79sXmUwiUNtAQnXjyPaZYBe6rJSOap6n8+wmWgKYdZiL7qHrJb+AtcSCZK4Xol3oanKLYtXpr0NUi8Rxp6m2JCJvSMI1GJb+c8BukhgZMk3iw2tz87z7ga98GT6Qorgm9qCw7+oBpvgWL9a+1Mg3PAYko2QIDAQAB';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifestVersion: 3,
  manifest: ({ browser, mode }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: [
      'tabs',
      'tabGroups',
      'storage',
      'unlimitedStorage',
      'contextMenus',
      'alarms',
      'identity',
      ...(browser === 'firefox' ? [] : ['favicon']),
      // Playwright cannot click a permission prompt, so e2e builds hold bookmarks from the start.
      ...(mode === 'e2e' ? ['bookmarks'] : []),
    ],
    optional_permissions: [...(mode === 'e2e' ? [] : ['bookmarks']), ...(browser === 'firefox' ? [] : ['readingList'])],
    omnibox: { keyword: '11' },
    ...(browser !== 'firefox' && process.env.SAVETAB_SELF_DISTRIBUTED === '1' ? { key: CHROME_KEY } : {}),
    action: { default_title: 'savetab', ...(browser === 'firefox' ? { default_area: 'navbar' } : {}) },
    commands: {
      _execute_action: { description: '__MSG_cmdExecuteAction__' },
      'display-onetab': {
        suggested_key: { default: 'Alt+Shift+1' },
        description: '__MSG_cmdDisplay__',
      },
      'send-current-tab-to-onetab': { description: '__MSG_cmdSendCurrent__' },
      'send-all-tabs-in-current-window-to-onetab': { description: '__MSG_cmdSendWindow__' },
      'send-all-tabs-in-current-tab-group-to-onetab': { description: '__MSG_cmdSendTabGroup__' },
      'send-all-tabs-except-this-to-onetab': { description: '__MSG_cmdSendExcept__' },
      'send-left-tabs-to-onetab': { description: '__MSG_cmdSendLeft__' },
      'send-right-tabs-to-onetab': { description: '__MSG_cmdSendRight__' },
      'send-all-tabs-in-all-windows-to-onetab': { description: '__MSG_cmdSendAllWindows__' },
    },
    browser_specific_settings:
      browser === 'firefox'
        ? {
            gecko: {
              id: 'savetab@kocean33',
              data_collection_permissions: { required: ['none'] },
              // A listed add-on updates from AMO, so only the GitHub Releases build sets update_url.
              ...(process.env.SAVETAB_SELF_DISTRIBUTED === '1'
                ? { update_url: 'https://github.com/KOCEAN33/savetab/releases/latest/download/updates.json' }
                : {}),
            },
          }
        : undefined,
  }),
});

import { defineConfig } from 'wxt';

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
      ...(browser === 'firefox' ? [] : ['favicon']),
      // Playwright cannot click a permission prompt, so e2e builds hold bookmarks from the start.
      ...(mode === 'e2e' ? ['bookmarks'] : []),
    ],
    optional_permissions: [...(mode === 'e2e' ? [] : ['bookmarks']), ...(browser === 'firefox' ? [] : ['readingList'])],
    omnibox: { keyword: '11' },
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
        ? { gecko: { id: 'savetab@kocean33', data_collection_permissions: { required: ['none'] } } }
        : undefined,
  }),
});

import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'savetab',
    description: 'Convert tabs into a list, restore them later, and sync the list across devices.',
    permissions: ['tabs', 'storage', 'unlimitedStorage', 'contextMenus', ...(browser === 'firefox' ? [] : ['favicon'])],
    action: { default_title: 'savetab', ...(browser === 'firefox' ? { default_area: 'navbar' } : {}) },
    commands: {
      _execute_action: { description: 'Same as clicking the savetab toolbar icon' },
      'display-onetab': {
        suggested_key: { default: 'Alt+Shift+1' },
        description: 'Display savetab',
      },
      'send-current-tab-to-onetab': { description: 'Send the current tab to savetab' },
      'send-all-tabs-in-current-window-to-onetab': { description: 'Send all tabs in this window to savetab' },
      'send-all-tabs-in-current-tab-group-to-onetab': { description: 'Send all tabs in this tab group to savetab' },
      'send-all-tabs-except-this-to-onetab': { description: 'Send all tabs except this tab to savetab' },
      'send-left-tabs-to-onetab': { description: 'Send tabs on the left to savetab' },
      'send-right-tabs-to-onetab': { description: 'Send tabs on the right to savetab' },
      'send-all-tabs-in-all-windows-to-onetab': { description: 'Send all tabs from all windows to savetab' },
    },
    browser_specific_settings:
      browser === 'firefox'
        ? { gecko: { id: 'savetab@kocean33', data_collection_permissions: { required: ['none'] } } }
        : undefined,
  }),
});

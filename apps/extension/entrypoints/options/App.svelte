<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import { readSettings, SETTINGS_ID, type ItemRecord } from '@savetab/core';
  import { db } from '@/lib/db';
  import {
    defaultDeviceSettings,
    deviceSettingsItem,
    getDeviceSettings,
    setDeviceSettings,
    setSettings,
    type DeviceSettings,
  } from '@/lib/settings';
  import Choice from '@/components/Choice.svelte';

  const record = liveQuery(() => db.items.get(SETTINGS_ID));
  const s = $derived(readSettings($record as ItemRecord | undefined));

  let device = $state<DeviceSettings>(defaultDeviceSettings);
  void getDeviceSettings().then((d) => (device = d));
  deviceSettingsItem.watch(() => void getDeviceSettings().then((d) => (device = d)));

  let newDomain = $state('');

  function addDomain() {
    const host = newDomain.trim().toLowerCase();
    newDomain = '';
    if (host && !s.excludedDomains.includes(host)) void setSettings({ excludedDomains: [...s.excludedDomains, host] });
  }

  const shortcutsUrl = import.meta.env.FIREFOX ? null : 'chrome://extensions/shortcuts';
</script>

<main>
  <header class="page-header">
    <h1 class="page-total">savetab options</h1>
    <nav class="page-nav"><a class="link-button" href={browser.runtime.getURL('/onetab.html')}>Back to savetab</a></nav>
  </header>

  <h2 class="section-title">Storing tabs</h2>
  <Choice
    legend="When you click the savetab toolbar icon:"
    value={device.toolbarAction}
    options={[
      ['sendWindow', 'Send tabs in the current window (only the selected tabs, or the current tab group, if any)'],
      ['sendWholeWindow', 'Send the current window, including all tabs and tab groups'],
      ['sendCurrent', 'Send only the current tab (it joins the first group that is not pinned or locked)'],
    ]}
    onchange={(v) => setDeviceSettings({ toolbarAction: v })}
  />
  <Choice
    legend="Pinned tabs:"
    value={s.pinnedTabs}
    options={[
      ['skip', "Don't send pinned tabs (sending only this tab still works)"],
      ['allow', 'Allow pinned tabs to be sent'],
    ]}
    onchange={(v) => setSettings({ pinnedTabs: v })}
  />
  <Choice
    legend="Duplicates:"
    value={s.duplicates}
    options={[
      ['allow', 'Allow duplicates'],
      ['reject', 'Silently reject duplicates'],
    ]}
    onchange={(v) => setSettings({ duplicates: v })}
  />
  <Choice
    legend="When storing a tab that is already stored:"
    value={s.titleOnDuplicate}
    options={[
      ['keep', 'Keep the existing title'],
      ['update', 'Use the latest title'],
    ]}
    onchange={(v) => setSettings({ titleOnDuplicate: v })}
  />
  <Choice
    legend="After storing tabs:"
    value={device.openAfterStore}
    options={[
      [true, 'Show the savetab list'],
      [false, 'Stay on the current page'],
    ]}
    onchange={(v) => setDeviceSettings({ openAfterStore: v })}
  />

  <fieldset class="choice">
    <legend>Excluded web sites (tabs from these hosts are not sent, unless you send only that tab):</legend>
    {#each s.excludedDomains as host (host)}
      <div class="row">
        <span>{host}</span>
        <button
          class="link-button"
          onclick={() => setSettings({ excludedDomains: s.excludedDomains.filter((d) => d !== host) })}>Remove</button
        >
      </div>
    {/each}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        addDomain();
      }}
    >
      <input type="text" placeholder="www.example.com" bind:value={newDomain} aria-label="Host to exclude" />
      <button class="button" type="submit">Add</button>
    </form>
  </fieldset>

  <h2 class="section-title">Restoring tabs</h2>
  <Choice
    legend="When restoring tabs:"
    value={s.afterRestore}
    options={[
      ['remove', 'Remove them from your list (hold Ctrl/Cmd to keep them)'],
      ['keep', 'Keep them in your list (hold Alt/Option to mark them archived)'],
      ['archive', 'Mark them as archived'],
    ]}
    onchange={(v) => setSettings({ afterRestore: v })}
  />
  <Choice
    legend="When restoring a group of tabs:"
    value={s.restoreGroupTarget}
    options={[
      ['newUnlessAlone', 'Open the tabs in a new window, unless savetab is the only tab in the current window'],
      ['new', 'Open the tabs in a new window'],
      ['current', 'Open the tabs in the current window'],
    ]}
    onchange={(v) => setSettings({ restoreGroupTarget: v })}
  />
  <Choice
    legend="When restoring a tab from the list:"
    value={s.switchToRestored}
    options={[
      [true, 'Open the tab and switch to it (unless you hold Cmd/Ctrl)'],
      [false, 'Open the tab and stay in savetab'],
    ]}
    onchange={(v) => setSettings({ switchToRestored: v })}
  />
  <Choice
    legend="When you click on a group's title:"
    value={s.groupTitleClick}
    options={[
      ['edit', 'Edit the title'],
      ['restore', 'Restore the group'],
    ]}
    onchange={(v) => setSettings({ groupTitleClick: v })}
  />

  <h2 class="section-title">Display</h2>
  <Choice
    legend="URL display:"
    value={s.urlDisplay}
    options={[
      ['none', 'None'],
      ['domain', 'Domain only'],
      ['abbreviated', 'Abbreviated'],
      ['full', 'Full'],
    ]}
    onchange={(v) => setSettings({ urlDisplay: v })}
  />
  <Choice
    legend="At browser startup:"
    value={device.openAtStartup}
    options={[
      [false, 'Do not open savetab automatically'],
      [true, 'Open savetab automatically'],
    ]}
    onchange={(v) => setDeviceSettings({ openAtStartup: v })}
  />
  <Choice
    legend={'"Display savetab" action:'}
    value={device.openOneTabMode}
    options={[
      ['switch', 'Switch to the window where savetab is already open'],
      ['move', 'Move an open savetab tab to the current window'],
    ]}
    onchange={(v) => setDeviceSettings({ openOneTabMode: v })}
  />
  <Choice
    legend="Right-click menu inside web pages:"
    value={device.contextMenu}
    options={[
      [true, 'Enabled'],
      [false, 'Disabled (the exclude-site item goes away too)'],
    ]}
    onchange={(v) => setDeviceSettings({ contextMenu: v })}
  />

  <h2 class="section-title">Keyboard shortcuts</h2>
  {#if shortcutsUrl}
    <button class="button" onclick={() => browser.tabs.create({ url: shortcutsUrl })}>Configure shortcuts</button>
  {:else}
    <p>Open about:addons, click the cog icon, then choose "Manage Extension Shortcuts".</p>
  {/if}
</main>

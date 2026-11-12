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
  import { t } from '@/lib/i18n';
  import { backupItem, takeBackup, type Backup } from '@/lib/backup';
  import Choice from '@/components/Choice.svelte';

  const record = liveQuery(() => db.items.get(SETTINGS_ID));
  const s = $derived(readSettings($record as ItemRecord | undefined));

  let device = $state<DeviceSettings>(defaultDeviceSettings);
  void getDeviceSettings().then((d) => (device = d));
  deviceSettingsItem.watch(() => void getDeviceSettings().then((d) => (device = d)));

  let backup = $state<Backup | null>(null);
  void backupItem.getValue().then((b) => (backup = b));
  backupItem.watch((b) => (backup = b));

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
    <h1 class="page-total">{t('optionsTitle')}</h1>
    <nav class="page-nav"><a class="link-button" href={browser.runtime.getURL('/onetab.html')}>{t('backToSavetab')}</a></nav>
  </header>

  <h2 class="section-title">{t('storingTabs')}</h2>
  <Choice
    legend={t('toolbarActionLegend')}
    value={device.toolbarAction}
    options={[
      ['sendWindow', t('toolbarSendWindow')],
      ['sendWholeWindow', t('toolbarSendWholeWindow')],
      ['sendCurrent', t('toolbarSendCurrent')],
      ['popup', t('toolbarPopup')],
    ]}
    onchange={(v) => setDeviceSettings({ toolbarAction: v })}
  />
  <Choice
    legend={t('pinnedTabsLegend')}
    value={s.pinnedTabs}
    options={[
      ['skip', t('pinnedSkip')],
      ['allow', t('pinnedAllow')],
    ]}
    onchange={(v) => setSettings({ pinnedTabs: v })}
  />
  <Choice
    legend={t('duplicatesLegend')}
    value={s.duplicates}
    options={[
      ['allow', t('duplicatesAllow')],
      ['reject', t('duplicatesReject')],
    ]}
    onchange={(v) => setSettings({ duplicates: v })}
  />
  <Choice
    legend={t('titleOnDuplicateLegend')}
    value={s.titleOnDuplicate}
    options={[
      ['keep', t('titleKeep')],
      ['update', t('titleUpdate')],
    ]}
    onchange={(v) => setSettings({ titleOnDuplicate: v })}
  />
  <Choice
    legend={t('afterStoreLegend')}
    value={device.openAfterStore}
    options={[
      [true, t('afterStoreShow')],
      [false, t('afterStoreStay')],
    ]}
    onchange={(v) => setDeviceSettings({ openAfterStore: v })}
  />

  <fieldset class="choice">
    <legend>{t('excludedLegend')}</legend>
    {#each s.excludedDomains as host (host)}
      <div class="row">
        <span>{host}</span>
        <button
          class="link-button"
          onclick={() => setSettings({ excludedDomains: s.excludedDomains.filter((d) => d !== host) })}>{t('remove')}</button
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
      <input type="text" placeholder="www.example.com" bind:value={newDomain} aria-label={t('hostToExclude')} />
      <button class="button" type="submit">{t('add')}</button>
    </form>
  </fieldset>

  <h2 class="section-title">{t('restoringTabs')}</h2>
  <Choice
    legend={t('afterRestoreLegend')}
    value={s.afterRestore}
    options={[
      ['remove', t('afterRestoreRemove')],
      ['keep', t('afterRestoreKeep')],
    ]}
    onchange={(v) => setSettings({ afterRestore: v })}
  />
  <Choice
    legend={t('restoreGroupLegend')}
    value={s.restoreGroupTarget}
    options={[
      ['newUnlessAlone', t('restoreNewUnlessAlone')],
      ['new', t('restoreNew')],
      ['current', t('restoreCurrent')],
    ]}
    onchange={(v) => setSettings({ restoreGroupTarget: v })}
  />
  <Choice
    legend={t('restoreTabLegend')}
    value={s.switchToRestored}
    options={[
      [true, t('restoreTabSwitch')],
      [false, t('restoreTabStay')],
    ]}
    onchange={(v) => setSettings({ switchToRestored: v })}
  />
  <Choice
    legend={t('groupTitleClickLegend')}
    value={s.groupTitleClick}
    options={[
      ['edit', t('groupTitleEdit')],
      ['restore', t('groupTitleRestore')],
    ]}
    onchange={(v) => setSettings({ groupTitleClick: v })}
  />
  <Choice
    legend={t('discardLegend')}
    value={s.discardOnOpen}
    options={[
      [false, t('discardOff')],
      [true, t('discardOn')],
    ]}
    onchange={(v) => setSettings({ discardOnOpen: v })}
  />

  <h2 class="section-title">{t('display')}</h2>
  <Choice
    legend={t('urlDisplayLegend')}
    value={s.urlDisplay}
    options={[
      ['none', t('urlNone')],
      ['domain', t('urlDomain')],
      ['abbreviated', t('urlAbbreviated')],
      ['full', t('urlFull')],
    ]}
    onchange={(v) => setSettings({ urlDisplay: v })}
  />
  <Choice
    legend={t('copyFormatLegend')}
    value={s.copyFormat}
    options={[
      ['rich', t('copyRich')],
      ['urlTitle', t('copyUrlTitle')],
      ['titleUrl', t('copyTitleUrl')],
      ['url', t('copyUrl')],
      ['markdown', t('copyMarkdown')],
    ]}
    onchange={(v) => setSettings({ copyFormat: v })}
  />
  <Choice
    legend={t('startupLegend')}
    value={device.openAtStartup}
    options={[
      [false, t('startupNo')],
      [true, t('startupYes')],
    ]}
    onchange={(v) => setDeviceSettings({ openAtStartup: v })}
  />
  <Choice
    legend={t('displayActionLegend')}
    value={device.openOneTabMode}
    options={[
      ['switch', t('displaySwitch')],
      ['move', t('displayMove')],
    ]}
    onchange={(v) => setDeviceSettings({ openOneTabMode: v })}
  />
  <Choice
    legend={t('contextMenuLegend')}
    value={device.contextMenu}
    options={[
      [true, t('contextMenuOn')],
      [false, t('contextMenuOff')],
    ]}
    onchange={(v) => setDeviceSettings({ contextMenu: v })}
  />
  <Choice
    legend={t('languageLegend')}
    value={device.language}
    options={[
      ['auto', t('languageAuto')],
      ['en', t('languageEn')],
      ['ko', t('languageKo')],
    ]}
    onchange={(v) => setDeviceSettings({ language: v })}
  />

  <h2 class="section-title">{t('backupTitle')}</h2>
  <p class="row">
    <span role="status"
      >{backup ? t('backupLast', { date: new Date(backup.takenAt).toLocaleString() }) : t('backupNone')}</span
    >
    <button class="button" onclick={takeBackup}>{t('backupNow')}</button>
  </p>

  <h2 class="section-title">{t('syncTitle')}</h2>
  <a class="button" href={browser.runtime.getURL('/account.html')}>{t('syncOpen')}</a>

  <h2 class="section-title">{t('keyboardShortcuts')}</h2>
  {#if shortcutsUrl}
    <button class="button" onclick={() => browser.tabs.create({ url: shortcutsUrl })}>{t('configureShortcuts')}</button>
  {:else}
    <p>{t('firefoxShortcuts')}</p>
  {/if}
</main>

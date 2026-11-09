<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { browser, type Browser } from 'wxt/browser';
  import { ListView, normalizeUrl, type Group, type Id, type ItemRecord } from '@savetab/core';
  import { hostnameOf, storeChosen } from '@/lib/capture';
  import { db } from '@/lib/db';
  import { t, tn } from '@/lib/i18n';
  import { duplicateTabIds, shownTabs, storedTabIds } from '@/lib/popup';
  import { recentItem } from '@/lib/recent';

  let tabs = $state<Browser.tabs.Tab[]>([]);
  let view = $state(new ListView([]));
  let recent = $state<Id[]>([]);

  // Playwright opens this page in a tab, so the e2e build takes the window to read from the URL.
  const windowParam = import.meta.env.MODE === 'e2e' ? Number(new URLSearchParams(location.search).get('window')) : NaN;

  async function load() {
    const windowId = Number.isNaN(windowParam) ? (await browser.windows.getCurrent()).id : windowParam;
    const own = browser.runtime.getURL('/');
    tabs = (await browser.tabs.query({ windowId })).filter((tab) => !tab.url?.startsWith(own));
    view = new ListView((await db.items.toArray()) as ItemRecord[]);
    recent = await recentItem.getValue();
  }
  void load();

  const storedUrls = $derived(
    new Set(view.groups(null).flatMap((g) => view.tabs(g.id).map((tab) => normalizeUrl(tab.url)))),
  );

  let pinned = $state(false);
  let grouped = $state(true);
  let stored = $state(true);
  const hiddenHosts = new SvelteSet<string>();
  const unticked = new SvelteSet<number>();

  const hosts = $derived([...new Set(tabs.map((tab) => hostnameOf(tab.url)).filter(Boolean))].sort());
  const shown = $derived(shownTabs(tabs, { pinned, grouped, stored, hiddenHosts }, storedUrls));
  const chosen = $derived(shown.filter((tab) => tab.id !== undefined && !unticked.has(tab.id)));

  let mode = $state<'new' | 'existing'>('new');
  let title = $state('');
  let groupQuery = $state('');
  let groupId = $state<Id | null>(null);

  const groupLabel = (g: Group) => g.title || tn('tabCount', view.tabs(g.id).length);
  /** Recent destinations first, then the other groups that are not locked, matching the search. */
  const destinations = $derived.by(() => {
    const open = view.groups(null).filter((g) => !g.locked);
    const first = recent.flatMap((id) => open.find((g) => g.id === id) ?? []);
    const q = groupQuery.trim().toLowerCase();
    return [...first, ...open.filter((g) => !first.includes(g))].filter(
      (g) => !q || groupLabel(g).toLowerCase().includes(q),
    );
  });

  let searchEl = $state<HTMLInputElement>();
  let status = $state('');

  async function send(close: boolean) {
    const dest = mode === 'existing' && groupId ? { groupId } : { title: title.trim() };
    await storeChosen(chosen, dest, close);
    status = t('popupStored', { tabs: tn('tabCount', chosen.length) });
    await load();
  }

  async function closeTabs(ids: number[]) {
    if (ids.length > 0) await browser.tabs.remove(ids);
    status = t('popupClosed', { tabs: tn('tabCount', ids.length) });
    await load();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    const target = e.target as HTMLElement;
    if (e.key !== '/' || target.closest('input, textarea, select')) return;
    e.preventDefault();
    mode = 'existing';
    searchEl?.focus();
  }}
/>

<main class="popup-main">
  <fieldset class="choice">
    <legend>{t('popupFilters')}</legend>
    <label><input type="checkbox" bind:checked={pinned} /> {t('popupIncludePinned')}</label>
    <label><input type="checkbox" bind:checked={grouped} /> {t('popupIncludeGrouped')}</label>
    <label><input type="checkbox" bind:checked={stored} /> {t('popupIncludeStored')}</label>
    {#each hosts as host (host)}
      <label>
        <input
          type="checkbox"
          checked={!hiddenHosts.has(host)}
          onchange={(e) => (e.currentTarget.checked ? hiddenHosts.delete(host) : hiddenHosts.add(host))}
        />
        {host}
      </label>
    {/each}
  </fieldset>

  <ul class="tabs" aria-label={t('popupTabs')}>
    {#each shown as tab (tab.id)}
      <li class="tab">
        <label>
          <input
            type="checkbox"
            checked={!unticked.has(tab.id!)}
            onchange={(e) => (e.currentTarget.checked ? unticked.delete(tab.id!) : unticked.add(tab.id!))}
          />
          {tab.title || tab.url}
        </label>
      </li>
    {/each}
  </ul>

  <fieldset class="choice">
    <legend>{t('popupDestination')}</legend>
    <label><input type="radio" bind:group={mode} value="new" /> {t('popupNewGroup')}</label>
    {#if mode === 'new'}
      <input type="text" aria-label={t('groupName')} placeholder={t('groupName')} bind:value={title} />
    {/if}
    <label><input type="radio" bind:group={mode} value="existing" /> {t('popupExistingGroup')}</label>
    {#if mode === 'existing'}
      <input
        type="search"
        aria-label={t('popupFindGroup')}
        placeholder={t('popupFindGroup')}
        bind:this={searchEl}
        bind:value={groupQuery}
      />
      <select aria-label={t('popupGroup')} size="6" bind:value={groupId}>
        {#each destinations as g (g.id)}<option value={g.id}>{groupLabel(g)}</option>{/each}
      </select>
    {/if}
  </fieldset>

  <p class="row">
    <button
      class="button button-primary"
      disabled={chosen.length === 0 || (mode === 'existing' && !groupId)}
      onclick={() => send(true)}>{tn('popupSend', chosen.length)}</button
    >
    {#if mode === 'existing' && groupId}
      <button class="button" disabled={chosen.length === 0} onclick={() => send(false)}>{t('popupMerge')}</button>
    {/if}
  </p>
  <p class="row">
    <button class="link-button" onclick={() => closeTabs(storedTabIds(tabs, storedUrls))}>{t('popupCloseStored')}</button>
    <button class="link-button" onclick={() => closeTabs(duplicateTabIds(tabs))}>{t('popupCloseDuplicates')}</button>
  </p>
  <p class="meta" role="status">{status}</p>
</main>

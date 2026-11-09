<script lang="ts">
  import { browser } from 'wxt/browser';
  import { updateItem, type ListView, type Tab } from '@savetab/core';
  import { act, editing } from '@/lib/ui.svelte';
  import { t } from '@/lib/i18n';
  import ItemMenu from './ItemMenu.svelte';
  import NotesField from './NotesField.svelte';
  import Tick from './Tick.svelte';
  import TitleField from './TitleField.svelte';

  let {
    tab,
    view,
    locked,
    onopen,
    ondelete,
  }: {
    tab: Tab;
    view: ListView;
    locked: boolean;
    onopen: (e: MouseEvent) => void;
    ondelete: () => void;
  } = $props();

  const settings = $derived(view.settings);
  const title = $derived(view.title(tab));
  const notes = $derived(view.notes(tab));

  function iconUrl(t: Tab): string {
    if (import.meta.env.FIREFOX) return t.favIconUrl;
    return browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(t.url)}&size=16` as '/');
  }

  function urlText(url: string): string {
    if (settings.urlDisplay === 'none') return '';
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return url;
    }
    if (settings.urlDisplay === 'domain') return u.hostname;
    if (settings.urlDisplay === 'abbreviated') return u.hostname + (u.pathname === '/' ? '' : u.pathname);
    return url;
  }

  function click(e: MouseEvent) {
    e.preventDefault();
    onopen(e);
  }

  const icon = $derived(iconUrl(tab));
  const shownUrl = $derived(urlText(tab.url));
</script>

<li class="tab" class:archived={tab.archived} data-nav="tab" data-id={tab.id} aria-label={title || tab.url}>
  {#if locked}
    <span class="tab-delete-slot"></span>
  {:else}
    <button class="tab-delete" title={t('delete')} aria-label={t('deleteItem', { name: title || tab.url })} onclick={ondelete}>×</button>
  {/if}
  <Tick id={tab.id} label={title || tab.url} />
  {#if tab.task !== 'none'}
    <input
      type="checkbox"
      aria-label={t('taskDone')}
      checked={tab.task === 'done'}
      onchange={(e) => {
        const task = e.currentTarget.checked ? 'done' : 'pending';
        void act((tx) => updateItem(tx, tab.id, { task }));
      }}
    />
  {/if}
  {#if icon}
    <img class="tab-icon" src={icon} alt="" draggable="false" />
  {:else}
    <span class="tab-icon"></span>
  {/if}
  {#if editing.title === tab.id}
    <TitleField item={tab} {title} label={t('tabTitle')} />
  {:else}
    <a class="tab-link" href={tab.url} draggable="false" onclick={click} onauxclick={(e) => e.button === 1 && click(e)}
      >{title || tab.url}</a
    >
  {/if}
  {#if shownUrl}<span class="tab-url meta">{shownUrl}</span>{/if}
  {#if tab.star}<span title={t('starred')}>★</span>{/if}
  {#if notes && editing.notes !== tab.id}<span class="tab-notes meta">{notes}</span>{/if}
  <ItemMenu item={tab} {view} label={t('more')} buttonClass="link-button tab-more" ariaLabel={t('moreActionsFor', { name: title || tab.url })} />
  {#if editing.notes === tab.id}
    <NotesField item={tab} {notes} />
  {/if}
</li>

<script lang="ts">
  import { browser } from 'wxt/browser';
  import type { ListView, Tab } from '@savetab/core';
  import { editing, menu, toggleMenu } from '@/lib/ui.svelte';
  import { t } from '@/lib/i18n';
  import Icon from './Icon.svelte';
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

  /**
   * A link that never was an open tab, such as an import, has no favicon, and Chrome's favicon
   * cache knows only pages it has shown. Such a link asks its site for `/favicon.ico`.
   */
  function iconUrl(t: Tab): string {
    if (!t.favIconUrl) return siteIcon(t.url);
    if (import.meta.env.FIREFOX) return t.favIconUrl;
    return browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(t.url)}&size=16` as '/');
  }

  function siteIcon(url: string): string {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}/favicon.ico` : '';
    } catch {
      return '';
    }
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

  let iconFailed = $state(false);
  const icon = $derived(iconFailed ? '' : iconUrl(tab));
  const shownUrl = $derived(urlText(tab.url));
</script>

<li class="tab" data-nav="tab" data-id={tab.id} aria-label={title || tab.url}>
  <Tick id={tab.id} label={title || tab.url} />
  {#if icon}
    <img class="tab-icon" src={icon} alt="" draggable="false" loading="lazy" onerror={() => (iconFailed = true)} />
  {:else}
    <span class="tab-icon tab-icon-none"><Icon name="globe" /></span>
  {/if}
  {#if editing.title === tab.id}
    <TitleField item={tab} {title} label={t('tabTitle')} />
  {:else}
    <a class="tab-link" href={tab.url} draggable="false" onclick={click} onauxclick={(e) => e.button === 1 && click(e)}
      >{title || tab.url}</a
    >
  {/if}
  {#if tab.star}<span class="star" title={t('starred')}><Icon name="star" /></span>{/if}
  {#if notes && editing.notes !== tab.id}<span class="tab-notes meta">{notes}</span>{/if}
  <span class="tab-end">
    {#if shownUrl}<span class="tab-url meta">{shownUrl}</span>{/if}
    <button
      class="icon-button row-action"
      title={t('more')}
      aria-label={t('moreActionsFor', { name: title || tab.url })}
      aria-haspopup="menu"
      aria-expanded={menu.id === tab.id}
      onclick={(e) => toggleMenu(tab.id, e.currentTarget)}><Icon name="more" /></button
    >
    {#if locked}
      <span class="row-action-slot"></span>
    {:else}
      <button class="icon-button row-action tab-delete" title={t('delete')} aria-label={t('deleteItem', { name: title || tab.url })} onclick={ondelete}
        ><Icon name="close" /></button
      >
    {/if}
  </span>
  {#if editing.notes === tab.id}
    <NotesField item={tab} {notes} />
  {/if}
</li>

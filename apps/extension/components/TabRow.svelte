<script lang="ts">
  import { browser } from 'wxt/browser';
  import type { Settings, Tab } from '@savetab/core';

  let {
    tab,
    title,
    settings,
    locked,
    onopen,
    ondelete,
  }: {
    tab: Tab;
    title: string;
    settings: Settings;
    locked: boolean;
    onopen: (e: MouseEvent) => void;
    ondelete: () => void;
  } = $props();

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

<li class="tab" class:archived={tab.archived}>
  {#if locked}
    <span class="tab-delete-slot"></span>
  {:else}
    <button class="tab-delete" title="Delete" aria-label="Delete {title || tab.url}" onclick={ondelete}>×</button>
  {/if}
  {#if icon}
    <img class="tab-icon" src={icon} alt="" draggable="false" />
  {:else}
    <span class="tab-icon"></span>
  {/if}
  <a class="tab-link" href={tab.url} draggable="false" onclick={click} onauxclick={(e) => e.button === 1 && click(e)}
    >{title || tab.url}</a
  >
  {#if shownUrl}<span class="tab-url meta">{shownUrl}</span>{/if}
  {#if tab.star}<span title="Starred">★</span>{/if}
</li>

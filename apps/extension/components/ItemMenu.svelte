<script lang="ts">
  import {
    createWithin,
    mergeInnerGroups,
    mergeIntoParent,
    removeDuplicates,
    trashItems,
    updateItem,
    type Item,
    type ItemPatch,
    type ListView,
    type RestoreTarget,
    type TabGroupColor,
  } from '@savetab/core';
  import { browser } from 'wxt/browser';
  import { copyLinks } from '@/lib/clipboard';
  import { clickIntent, restoreGroup } from '@/lib/restore';
  import { saveHtml } from '@/lib/save-html';
  import { activeShare, shareItem, shareLink, stopSharing } from '@/lib/share';
  import { act, chooser, editing, menu } from '@/lib/ui.svelte';
  import { t } from '@/lib/i18n';

  /** Gap in px kept between the menu and the viewport edge. */
  const EDGE = 8;

  /** `server` is the sync server's URL on a device with an account. Sharing needs one. */
  let { item, view, server }: { item: Item; view: ListView; server?: string } = $props();

  // The page keys this component by item, and a mutation may run after the menu closed and unmounted.
  // svelte-ignore state_referenced_locally
  const id = item.id;

  let el = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0 });

  /** Hang below the button, right edges aligned, and stay inside the viewport. */
  $effect(() => {
    if (!el || !menu.anchor) return;
    const r = menu.anchor.getBoundingClientRect();
    pos = {
      left: Math.max(EDGE, Math.min(r.right - el.offsetWidth, innerWidth - el.offsetWidth - EDGE)),
      top: Math.max(EDGE, Math.min(r.bottom + EDGE / 2, innerHeight - el.offsetHeight - EDGE)),
    };
  });

  const locked = $derived(item.kind === 'group' && item.locked);
  const shared = $derived(activeShare(item));

  /** The upload and the delete can fail on the network, which `act` does not cover. */
  function sharing(fn: () => Promise<unknown>) {
    close(() => fn().catch(() => alert(t('shareFailed'))));
  }

  function share() {
    const shownView = view;
    const shownItem = item;
    sharing(async () => {
      const url = await shareItem(shownView, shownItem);
      // The page can lose focus during the upload, and the clipboard then refuses the write.
      await navigator.clipboard.writeText(url).catch(() => alert(t('shareNotCopied')));
    });
  }

  /** `fn` runs first: closing unmounts this component, and `item` is gone after that. */
  function close(fn: () => unknown) {
    fn();
    menu.id = null;
  }

  const set = (patch: ItemPatch) => close(() => act((tx) => updateItem(tx, id, patch)));

  function create(kind: 'folder' | 'group') {
    close(async () => {
      const created = await act((tx) => createWithin(tx, kind, id));
      if (created) editing.title = created;
    });
  }

  function dedupe() {
    close(async () => {
      const n = await act((tx) => removeDuplicates(tx, id));
      if (n === 0) alert(t('noDuplicates'));
    });
  }

  /** A restore choice sticks to the group: Restore all and a title click use it until "Use default restore". */
  function restoreIn(e: MouseEvent, restoreTarget: RestoreTarget) {
    const group = item;
    if (group.kind !== 'group') return;
    const tabs = view.tabs(group.id);
    const intent = clickIntent(e, view.settings);
    close(async () => {
      await act((tx) => updateItem(tx, group.id, { restoreTarget }));
      await restoreGroup(tabs, intent, view.settings, { ...group, restoreTarget });
    });
  }

  /** Browsers without the tab group API, such as Firefox before 139, hide the tab group entries. */
  const hasTabGroups = !!browser.tabGroups;
  const COLORS = [
    ['grey', 'colorGrey'],
    ['blue', 'colorBlue'],
    ['red', 'colorRed'],
    ['yellow', 'colorYellow'],
    ['green', 'colorGreen'],
    ['pink', 'colorPink'],
    ['purple', 'colorPurple'],
    ['cyan', 'colorCyan'],
    ['orange', 'colorOrange'],
  ] as const satisfies [TabGroupColor, string][];
</script>

<svelte:window
  onclick={(e) => {
    const target = e.target as Node;
    if (!el?.contains(target) && !menu.anchor?.contains(target)) menu.id = null;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') menu.id = null;
  }}
  onscrollcapture={(e) => {
    if (!el?.contains(e.target as Node)) menu.id = null;
  }}
/>

<div class="menu item-menu" role="menu" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px">
  <button role="menuitem" onclick={() => close(() => (editing.title = id))}>{t('menuRename')}</button>
  <button role="menuitem" onclick={() => close(() => (editing.notes = id))}>
    {view.notes(item) ? t('menuEditNote') : t('menuAddNote')}
  </button>
  {#if item.kind === 'group'}
    <button role="menuitem" onclick={() => set({ locked: !item.locked })}>
      {item.locked ? t('menuUnlockGroup') : t('menuLockGroup')}
    </button>
    <hr />
    <button role="menuitem" onclick={(e) => restoreIn(e, 'current')}>{t('menuRestoreCurrent')}</button>
    <button role="menuitem" onclick={(e) => restoreIn(e, 'new')}>{t('menuRestoreNew')}</button>
    <button role="menuitem" onclick={(e) => restoreIn(e, 'incognito')}>{t('menuRestoreIncognito')}</button>
    {#if item.restoreTarget !== 'default'}
      <button role="menuitem" onclick={() => set({ restoreTarget: 'default' })}>{t('menuUseDefaultRestore')}</button>
    {/if}
    {#if hasTabGroups}
      {@const openAs = item.openAs}
      <button
        role="menuitemcheckbox"
        aria-checked={openAs.mode === 'tabGroup'}
        onclick={() => set({ openAs: { ...openAs, mode: openAs.mode === 'tabGroup' ? 'window' : 'tabGroup' } })}
      >
        {t('menuOpenAsTabGroup')}
      </button>
      {#if openAs.mode === 'tabGroup'}
        <label class="menu-field">
          {t('tabGroupColor')}
          <select
            value={openAs.color}
            onchange={(e) => {
              const color = e.currentTarget.value as TabGroupColor;
              void act((tx) => updateItem(tx, id, { openAs: { ...openAs, color } }));
            }}
          >
            {#each COLORS as [c, key] (c)}<option value={c}>{t(key)}</option>{/each}
          </select>
        </label>
        <button
          role="menuitemcheckbox"
          aria-checked={openAs.collapsed}
          onclick={() => set({ openAs: { ...openAs, collapsed: !openAs.collapsed } })}
        >
          {t('tabGroupCollapsed')}
        </button>
      {/if}
    {/if}
    <hr />
  {/if}
  {#if item.kind === 'tab'}
    <button role="menuitemcheckbox" aria-checked={item.pinOnOpen} onclick={() => set({ pinOnOpen: !item.pinOnOpen })}>
      {t('menuPinOnOpen')}
    </button>
  {/if}
  {#if item.kind !== 'folder'}
    <button role="menuitem" onclick={() => set({ star: !item.star })}>
      {item.star ? t('menuRemoveStar') : item.kind === 'group' ? t('menuStarGroup') : t('menuStarTab')}
    </button>
  {/if}
  {#if item.kind !== 'tab'}
    <button role="menuitem" onclick={() => set({ pinnedTop: !item.pinnedTop })}>
      {item.pinnedTop ? t('menuUnpin') : t('menuPinTop')}
    </button>
    {#if item.kind === 'folder'}
      <hr />
      <button role="menuitem" onclick={() => create('group')}>{t('menuCreateGroupWithin')}</button>
      <button role="menuitem" onclick={() => create('folder')}>{t('menuCreateFolderWithin')}</button>
      <hr />
      <button role="menuitem" onclick={() => close(() => act((tx) => mergeIntoParent(tx, id)))}>
        {t('menuMergeIntoParent')}
      </button>
      <button role="menuitem" onclick={() => close(() => act((tx) => mergeInnerGroups(tx, id)))}>
        {t('menuMergeInnerGroups')}
      </button>
    {/if}
    <hr />
    <button role="menuitem" onclick={() => dedupe()}>{t('menuDedupeWithin')}</button>
  {/if}
  <hr />
  {#if !locked}
    <button role="menuitem" onclick={() => close(() => Object.assign(chooser, { ids: [id], mode: 'move' }))}>
      {t('menuMove')}
    </button>
  {/if}
  <button role="menuitem" onclick={() => close(() => Object.assign(chooser, { ids: [id], mode: 'copy' }))}>
    {t('menuCopy')}
  </button>
  {#if item.kind !== 'tab'}
    <button role="menuitem" onclick={() => close(() => saveHtml(view, item))}>{t('menuSaveHtml')}</button>
    {#if server && shared}
      <button role="menuitem" onclick={() => close(() => navigator.clipboard.writeText(shareLink(server, shared)))}>
        {t('menuCopyShareLink')}
      </button>
      <button role="menuitem" onclick={() => sharing(() => stopSharing(item))}>{t('menuStopSharing')}</button>
    {:else if server}
      <button role="menuitem" onclick={share}>{t('menuShare')}</button>
    {/if}
  {/if}
  <button role="menuitem" onclick={() => close(() => copyLinks(view, [item]))}>
    {item.kind === 'tab' ? t('menuCopyLink') : t('menuCopyLinks')}
  </button>
  {#if !locked}
    <button role="menuitem" onclick={() => close(() => act((tx) => trashItems(tx, [id])))}>{t('moveToTrash')}</button>
  {/if}
</div>

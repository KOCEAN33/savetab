<script lang="ts">
  import {
    createWithin,
    mergeInnerGroups,
    mergeIntoParent,
    trashItems,
    updateItem,
    type Group,
    type Item,
    type ItemPatch,
    type ListView,
    type RestoreTarget,
    type TabGroupColor,
  } from '@savetab/core';
  import { browser } from 'wxt/browser';
  import { copyLinks } from '@/lib/clipboard';
  import { clickIntent, restoreGroup, restoreSelected } from '@/lib/restore';
  import { saveHtml } from '@/lib/save-html';
  import { activeShare, shareItem, shareLink, stopSharing } from '@/lib/share';
  import { act, choose, dedupe, editing, menu, selection, targets } from '@/lib/ui.svelte';
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

  /** The items the entries apply to. Entries that only make sense on one item hide when there are more. */
  const items = $derived(targets(view, id));
  const many = $derived(items.length > 1);
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

  /**
   * `fn` gets the items and runs first: closing unmounts this component, and `item` is gone after
   * that. An entry applied to the ticked items spends the ticks, unless `fn` refuses them with false.
   */
  function close(fn: (all: Item[]) => unknown) {
    const all = items;
    const spent = fn(all) !== false;
    menu.id = null;
    if (spent && all.length > 1) selection.clear();
  }

  const groupsIn = (all: Item[]) => all.filter((i): i is Group => i.kind === 'group');

  /** Patch the items whose kind is in `kinds`, the kinds the entry is shown for. */
  const set = (patch: ItemPatch, kinds: Item['kind'][]) =>
    close((all) =>
      act(async (tx) => {
        for (const i of all) if (kinds.includes(i.kind)) await updateItem(tx, i.id, patch);
      }),
    );

  function setOpenAs(all: Item[], change: Partial<Group['openAs']>) {
    return act(async (tx) => {
      for (const g of groupsIn(all)) await updateItem(tx, g.id, { openAs: { ...g.openAs, ...change } });
    });
  }

  function create(kind: 'folder' | 'group') {
    close(async () => {
      const created = await act((tx) => createWithin(tx, kind, id));
      if (created) editing.title = created;
    });
  }

  /** Merge each folder of `all` with `merge`. */
  function mergeEach(merge: typeof mergeIntoParent) {
    close((all) =>
      act(async (tx) => {
        for (const i of all) if (i.kind === 'folder') await merge(tx, i.id);
      }),
    );
  }

  /** A restore choice sticks to the group: Restore all and a title click use it until "Use default restore". */
  function restoreIn(e: MouseEvent, restoreTarget: RestoreTarget) {
    const intent = clickIntent(e, view.settings);
    const settings = view.settings;
    close(async (all) => {
      const groups = groupsIn(all).map((g) => ({ group: g, tabs: view.tabs(g.id) }));
      await act(async (tx) => {
        for (const { group } of groups) await updateItem(tx, group.id, { restoreTarget });
      });
      for (const { group, tabs } of groups) await restoreGroup(tabs, intent, settings, { ...group, restoreTarget });
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
  {#if many}
    <p class="menu-field meta">{t('selectedCount', { n: items.length })}</p>
  {:else}
    <button role="menuitem" onclick={() => close(() => (editing.title = id))}>{t('menuRename')}</button>
    <button role="menuitem" onclick={() => close(() => (editing.notes = id))}>
      {view.notes(item) ? t('menuEditNote') : t('menuAddNote')}
    </button>
  {/if}
  {#if item.kind === 'group'}
    <button role="menuitem" onclick={() => set({ locked: !item.locked }, ['group'])}>
      {item.locked ? t('menuUnlockGroup') : t('menuLockGroup')}
    </button>
    <hr />
    <button role="menuitem" onclick={(e) => restoreIn(e, 'current')}>{t('menuRestoreCurrent')}</button>
    <button role="menuitem" onclick={(e) => restoreIn(e, 'new')}>{t('menuRestoreNew')}</button>
    <button role="menuitem" onclick={(e) => restoreIn(e, 'incognito')}>{t('menuRestoreIncognito')}</button>
    {#if item.restoreTarget !== 'default'}
      <button role="menuitem" onclick={() => set({ restoreTarget: 'default' }, ['group'])}>{t('menuUseDefaultRestore')}</button>
    {/if}
    {#if hasTabGroups}
      {@const openAs = item.openAs}
      <button
        role="menuitemcheckbox"
        aria-checked={openAs.mode === 'tabGroup'}
        onclick={() => close((all) => setOpenAs(all, { mode: openAs.mode === 'tabGroup' ? 'window' : 'tabGroup' }))}
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
              void setOpenAs(items, { color });
            }}
          >
            {#each COLORS as [c, key] (c)}<option value={c}>{t(key)}</option>{/each}
          </select>
        </label>
        <button
          role="menuitemcheckbox"
          aria-checked={openAs.collapsed}
          onclick={() => close((all) => setOpenAs(all, { collapsed: !openAs.collapsed }))}
        >
          {t('tabGroupCollapsed')}
        </button>
      {/if}
    {/if}
    <hr />
  {/if}
  {#if item.kind === 'tab'}
    <button
      role="menuitem"
      onclick={(e) => {
        const intent = { ...clickIntent(e, view.settings), newWindow: true };
        const settings = view.settings;
        close((all) => restoreSelected(all.filter((i) => i.kind === 'tab'), intent, settings));
      }}
    >
      {t('menuOpenNewWindow')}
    </button>
    <button role="menuitemcheckbox" aria-checked={item.pinOnOpen} onclick={() => set({ pinOnOpen: !item.pinOnOpen }, ['tab'])}>
      {t('menuPinOnOpen')}
    </button>
  {/if}
  {#if item.kind !== 'folder'}
    <button role="menuitem" onclick={() => set({ star: !item.star }, ['tab', 'group'])}>
      {item.star ? t('menuRemoveStar') : many ? t('star') : item.kind === 'group' ? t('menuStarGroup') : t('menuStarTab')}
    </button>
  {/if}
  {#if item.kind !== 'tab'}
    <button role="menuitem" onclick={() => set({ pinnedTop: !item.pinnedTop }, ['group', 'folder'])}>
      {item.pinnedTop ? t('menuUnpin') : t('menuPinTop')}
    </button>
    {#if item.kind === 'folder'}
      {#if !many}
        <hr />
        <button role="menuitem" onclick={() => create('group')}>{t('menuCreateGroupWithin')}</button>
        <button role="menuitem" onclick={() => create('folder')}>{t('menuCreateFolderWithin')}</button>
      {/if}
      <hr />
      <button role="menuitem" onclick={() => mergeEach(mergeIntoParent)}>
        {t('menuMergeIntoParent')}
      </button>
      <button role="menuitem" onclick={() => mergeEach(mergeInnerGroups)}>
        {t('menuMergeInnerGroups')}
      </button>
    {/if}
    <hr />
    <button role="menuitem" onclick={() => close((all) => dedupe(all.filter((i) => i.kind !== 'tab').map((i) => i.id)))}>{t('menuDedupeWithin')}</button>
  {/if}
  <hr />
  {#if !locked}
    <button role="menuitem" onclick={() => close((all) => choose(all, 'move'))}>
      {t('menuMove')}
    </button>
  {/if}
  <button role="menuitem" onclick={() => close((all) => choose(all, 'copy'))}>
    {t('menuCopy')}
  </button>
  {#if item.kind !== 'tab' && !many}
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
  <button role="menuitem" onclick={() => close((all) => copyLinks(view, all))}>
    {item.kind === 'tab' && !many ? t('menuCopyLink') : t('menuCopyLinks')}
  </button>
  {#if !locked}
    <button role="menuitem" onclick={() => close((all) => act((tx) => trashItems(tx, all.map((i) => i.id))))}>{t('moveToTrash')}</button>
  {/if}
</div>

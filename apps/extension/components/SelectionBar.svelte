<script lang="ts">
  import { trashItems, updateItem, type Id, type ItemPatch, type ListView, type Tab } from '@savetab/core';
  import { copyLinks } from '@/lib/clipboard';
  import { clickIntent, restoreSelected } from '@/lib/restore';
  import { selectCommand, type SelectCommand } from '@/lib/selection';
  import { act, choose, selectMenu, selection, ticked } from '@/lib/ui.svelte';
  import { t } from '@/lib/i18n';

  let { view, order }: { view: ListView; order: Id[] } = $props();

  const items = $derived(ticked(view));

  /** Tabs of the selection, each once, in list order. */
  const tabs = $derived.by(() => {
    const seen = new Set<Id>();
    const out: Tab[] = [];
    const add = (t: Tab) => !seen.has(t.id) && (seen.add(t.id), out.push(t));
    for (const item of items) {
      if (item.kind === 'tab') add(item);
      else for (const g of item.kind === 'group' ? [item] : view.groups(item.id)) view.tabs(g.id).forEach(add);
    }
    return out;
  });

  function done(fn: () => unknown) {
    fn();
    selection.clear();
  }

  function setAll(patch: ItemPatch) {
    const ids = items.filter((i) => i.kind !== 'folder').map((i) => i.id);
    done(() =>
      act(async (tx) => {
        for (const id of ids) await updateItem(tx, id, patch);
      }),
    );
  }

  function trash() {
    const ids = items.map((i) => i.id);
    done(() => act((tx) => trashItems(tx, ids)));
  }

  function command(c: SelectCommand) {
    const next = selectCommand(c, order, selection, selectMenu.id!);
    selection.clear();
    for (const id of next) selection.add(id);
    selectMenu.id = null;
  }

  const COMMANDS: [SelectCommand, string][] = [
    ['all', t('selectAll')],
    ['none', t('deselectAll')],
    ['invert', t('invertSelection')],
    ['allExcept', t('selectAllExcept')],
    ['thisAndAbove', t('selectThisAndAbove')],
    ['thisAndBelow', t('selectThisAndBelow')],
  ];
</script>

<svelte:window
  onclick={(e) => {
    if (selectMenu.id && !(e.target as Element).closest('.select-menu')) selectMenu.id = null;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') selectMenu.id = null;
  }}
/>

{#if selectMenu.id}
  <div class="menu select-menu" role="menu" style:left="{selectMenu.x}px" style:top="{selectMenu.y}px">
    {#each COMMANDS as [c, label] (c)}
      <button role="menuitem" onclick={() => command(c)}>{label}</button>
    {/each}
  </div>
{/if}

{#if items.length > 0}
  <div class="selection-bar" role="toolbar" aria-label={t('selection')}>
    <span>{t('selectedCount', { n: items.length })}</span>
    <button class="link-button" onclick={(e) => done(() => restoreSelected(tabs, clickIntent(e, view.settings), view.settings))}>
      {t('restore')}
    </button>
    <button class="link-button" onclick={() => choose(items, 'move') && selection.clear()}>{t('menuMove')}</button>
    <button class="link-button" onclick={() => choose(items, 'copy') && selection.clear()}>{t('menuCopy')}</button>
    <button class="link-button" onclick={() => setAll({ star: true })}>{t('star')}</button>
    <button class="link-button" onclick={() => copyLinks(view, items)}>{t('copyLinks')}</button>
    <button class="link-button" onclick={trash}>{t('moveToTrash')}</button>
    <button class="link-button" onclick={() => selection.clear()}>{t('clear')}</button>
  </div>
{/if}

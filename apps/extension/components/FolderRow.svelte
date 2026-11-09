<script lang="ts">
  import { dragHandle } from 'svelte-dnd-action';
  import { updateItem, type Folder, type ListView } from '@savetab/core';
  import { act, editing } from '@/lib/ui.svelte';
  import { t, tn } from '@/lib/i18n';
  import ItemMenu from './ItemMenu.svelte';
  import NotesField from './NotesField.svelte';
  import Tick from './Tick.svelte';
  import TitleField from './TitleField.svelte';

  let { folder, view, onopen }: { folder: Folder; view: ListView; onopen: () => void } = $props();

  const label = $derived(folder.title || t('untitledFolder'));
  const count = $derived(view.tabCount(folder.id));
</script>

<section class="group folder" id="item-{folder.id}" aria-label={t('folderLabel', { name: label })}>
  <div class="group-head" tabindex="0" role="treeitem" aria-selected="false" aria-expanded={!folder.collapsed} aria-label={t('folderLabel', { name: label })} data-nav="folder" data-id={folder.id}>
    <span class="group-grip" use:dragHandle aria-label={t('dragItem', { name: label })}>⠿</span>
    <Tick id={folder.id} {label} />
    {#if editing.title === folder.id}
      <TitleField item={folder} title={folder.title} label={t('folderName')} />
    {:else}
      <button class="group-label" onclick={onopen}>{label}</button>
    {/if}
    <span class="meta">{[folder.pinnedTop && t('pinned'), tn('folderTabs', count)].filter(Boolean).join(', ')}</span>
    <ItemMenu item={folder} {view} />
    <button
      class="link-button"
      aria-expanded={!folder.collapsed}
      title={t('folderCollapseHint')}
      onclick={() => act((tx) => updateItem(tx, folder.id, { collapsed: !folder.collapsed }))}
      >{folder.collapsed ? t('expand') : t('collapse')}</button
    >
  </div>
  {#if editing.notes === folder.id}
    <NotesField item={folder} notes={folder.notes} />
  {:else if folder.notes}
    <p class="notes meta">{folder.notes}</p>
  {/if}
</section>

<script lang="ts">
  import { dragHandle } from 'svelte-dnd-action';
  import { updateItem, type Folder, type ListView } from '@savetab/core';
  import { act, editing } from '@/lib/ui.svelte';
  import ItemMenu from './ItemMenu.svelte';
  import NotesField from './NotesField.svelte';
  import Tick from './Tick.svelte';
  import TitleField from './TitleField.svelte';

  let { folder, view, onopen }: { folder: Folder; view: ListView; onopen: () => void } = $props();

  const label = $derived(folder.title || 'Untitled folder');
  const count = $derived(view.tabCount(folder.id));
</script>

<section class="group folder" id="item-{folder.id}" aria-label="Folder {label}">
  <div class="group-head">
    <span class="group-grip" use:dragHandle aria-label="Drag {label}">⠿</span>
    <Tick id={folder.id} {label} />
    {#if editing.title === folder.id}
      <TitleField item={folder} title={folder.title} label="Folder name" />
    {:else}
      <button class="group-label" onclick={onopen}>{label}</button>
    {/if}
    <span class="meta">{[folder.pinnedTop && 'Pinned', `Folder, ${count} ${count === 1 ? 'tab' : 'tabs'}`].filter(Boolean).join(', ')}</span>
    <ItemMenu item={folder} {view} />
    <button
      class="link-button"
      aria-expanded={!folder.collapsed}
      title="Show or hide its folders in the folder column"
      onclick={() => act((tx) => updateItem(tx, folder.id, { collapsed: !folder.collapsed }))}
      >{folder.collapsed ? 'Expand' : 'Collapse'}</button
    >
  </div>
  {#if editing.notes === folder.id}
    <NotesField item={folder} notes={folder.notes} />
  {:else if folder.notes}
    <p class="notes meta">{folder.notes}</p>
  {/if}
</section>

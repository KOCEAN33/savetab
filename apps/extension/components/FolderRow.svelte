<script lang="ts">
  import { dragHandle } from 'svelte-dnd-action';
  import { trashItems, updateItem, type Folder, type ListView } from '@savetab/core';
  import { transact } from '@/lib/db';

  let {
    folder,
    view,
    editing = $bindable(false),
    onopen,
  }: {
    folder: Folder;
    view: ListView;
    editing?: boolean;
    onopen: () => void;
  } = $props();

  let draft = $state('');
  const label = $derived(folder.title || 'Untitled folder');
  const count = $derived(view.tabCount(folder.id));

  $effect(() => {
    if (editing) draft = folder.title;
  });

  function run(fn: Parameters<typeof transact>[0]) {
    return transact(fn).catch((err) => alert(err instanceof Error ? err.message : String(err)));
  }

  function save() {
    if (!editing) return;
    editing = false;
    if (draft.trim() !== folder.title) void run((tx) => updateItem(tx, folder.id, { title: draft.trim() }));
  }
</script>

<section class="group folder" id="item-{folder.id}" aria-label="Folder {label}">
  <div class="group-head">
    <span class="group-grip" use:dragHandle aria-label="Drag {label}">⠿</span>
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="group-title-input"
        type="text"
        aria-label="Folder name"
        bind:value={draft}
        autofocus
        onblur={save}
        onkeydown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') editing = false;
        }}
      />
    {:else}
      <button class="group-label" onclick={onopen}>{label}</button>
    {/if}
    <span class="meta">Folder, {count} {count === 1 ? 'tab' : 'tabs'}</span>
    <button class="link-button" onclick={() => (editing = true)}>Rename</button>
    <button class="link-button" onclick={() => run((tx) => trashItems(tx, [folder.id]))}>Delete</button>
  </div>
</section>

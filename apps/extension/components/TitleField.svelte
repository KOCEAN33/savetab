<script lang="ts">
  import { editTab, updateItem, type Item } from '@savetab/core';
  import { act, editing } from '@/lib/ui.svelte';

  let { item, title, label }: { item: Item; title: string; label: string } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state(title);

  function save() {
    if (editing.title !== item.id) return;
    editing.title = null;
    const next = draft.trim();
    if (next === title) return;
    void act((tx) => (item.kind === 'tab' ? editTab(tx, item.id, { title: next }) : updateItem(tx, item.id, { title: next })));
  }
</script>

<!-- svelte-ignore a11y_autofocus -->
<input
  class={item.kind === 'tab' ? 'tab-title-input' : 'group-title-input'}
  type="text"
  aria-label={label}
  bind:value={draft}
  autofocus
  onblur={save}
  onkeydown={(e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') editing.title = null;
  }}
/>

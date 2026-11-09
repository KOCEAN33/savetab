<script lang="ts">
  import { editTab, NOTES_MAX, updateItem, type Item } from '@savetab/core';
  import { act, editing } from '@/lib/ui.svelte';

  let { item, notes }: { item: Item; notes: string } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state(notes);

  function save() {
    if (editing.notes !== item.id) return;
    editing.notes = null;
    const next = draft.trim();
    if (next === notes) return;
    void act((tx) => (item.kind === 'tab' ? editTab(tx, item.id, { notes: next }) : updateItem(tx, item.id, { notes: next })));
  }
</script>

<!-- svelte-ignore a11y_autofocus -->
<textarea
  class="notes-input"
  aria-label="Note"
  maxlength={NOTES_MAX}
  bind:value={draft}
  autofocus
  onblur={save}
  onkeydown={(e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
    if (e.key === 'Escape') editing.notes = null;
  }}
></textarea>

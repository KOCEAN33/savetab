<script lang="ts">
  import type { Id } from '@savetab/core';
  import { selectMenu, selection } from '@/lib/ui.svelte';

  let { id, label }: { id: Id; label: string } = $props();
</script>

<input
  class="tick"
  class:tick-shown={selection.size > 0}
  type="checkbox"
  aria-label="Select {label}"
  checked={selection.has(id)}
  onchange={(e) => (e.currentTarget.checked ? selection.add(id) : selection.delete(id))}
  oncontextmenu={(e) => {
    e.preventDefault();
    Object.assign(selectMenu, { id, x: e.clientX, y: e.clientY });
  }}
/>

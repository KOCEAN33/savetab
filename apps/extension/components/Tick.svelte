<script lang="ts">
  import type { Id } from '@savetab/core';
  import { selectMenu, selection } from '@/lib/ui.svelte';
  import { t } from '@/lib/i18n';

  let { id, label }: { id: Id; label: string } = $props();
</script>

<label
  class="tick"
  class:tick-shown={selection.size > 0}
  oncontextmenu={(e) => {
    e.preventDefault();
    Object.assign(selectMenu, { id, x: e.clientX, y: e.clientY });
  }}
>
  <input
    type="checkbox"
    aria-label={t('selectItem', { name: label })}
    checked={selection.has(id)}
    onchange={(e) => (e.currentTarget.checked ? selection.add(id) : selection.delete(id))}
  />
</label>

<script lang="ts">
  import { dndzone, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { moveItems, TOP, type Folder, type Id, type Item, type ListView } from '@savetab/core';
  import { activeShare } from '@/lib/share';
  import { act, editing, menu, toggleMenu } from '@/lib/ui.svelte';
  import { shortDate, t } from '@/lib/i18n';
  import { DROP_TARGET } from '@/lib/motion';
  import Icon from './Icon.svelte';
  import NotesField from './NotesField.svelte';
  import TitleField from './TitleField.svelte';

  let {
    view,
    current,
    onopen,
    onnew,
  }: {
    view: ListView;
    current: Id | null;
    onopen: (item: Item | null) => void;
    onnew: () => void;
  } = $props();

  const open = $derived(current ? (view.get(current) as Folder | undefined) : undefined);
  const shared = $derived(open && activeShare(open));
  const trail = $derived(open ? [...view.path(open.id), open] : []);
  const inside = $derived(view.children(current).filter((i) => i.kind === 'folder'));

  /** Drop zones hold only the dragged group's placeholder while it hovers. */
  let drops = $state<Record<string, Item[]>>({});

  /** A group dropped on a folder moves into it. */
  function finalize(targetId: Id | null, e: CustomEvent<DndEvent<Item>>) {
    drops[targetId ?? ''] = [];
    const { id, trigger } = e.detail.info;
    if (trigger !== TRIGGERS.DROPPED_INTO_ZONE || id === targetId) return;
    void act((tx) => moveItems(tx, [id], targetId, TOP));
  }
</script>

<!-- A drop zone overlays a chip. It ignores the pointer, so the chip stays clickable,
     while svelte-dnd-action finds zones by their rectangles. -->
{#snippet chip(folder: Folder | null)}
  {@const id = folder?.id ?? null}
  <span class="chip-slot">
    {#if folder && editing.title === folder.id}
      <TitleField item={folder} title={folder.title} label={t('folderName')} />
    {:else}
      <button class="chip" aria-current={id === current ? 'page' : undefined} onclick={() => onopen(folder)}
        >{folder ? folder.title || t('untitledFolder') : t('allTabs')}</button
      >
    {/if}
    <span
      class="chip-drop"
      use:dndzone={{ items: drops[id ?? ''] ?? [], type: 'group', flipDurationMs: 0, ...DROP_TARGET }}
      onconsider={(e) => (drops[id ?? ''] = e.detail.items)}
      onfinalize={(e) => finalize(id, e)}
    >
      {#each drops[id ?? ''] ?? [] as d (d.id)}<span></span>{/each}
    </span>
  </span>
{/snippet}

<nav class="folder-bar" aria-label={t('folders')}>
  {@render chip(null)}
  {#each trail as f (f.id)}
    <span class="meta">/</span>
    {@render chip(f as Folder)}
  {/each}
  {#if open}
    <button
      class="icon-button"
      title={t('menuMore')}
      aria-label={t('moreActionsFor', { name: open.title || t('untitledFolder') })}
      aria-haspopup="menu"
      aria-expanded={menu.id === open.id}
      onclick={(e) => toggleMenu(open.id, e.currentTarget)}><Icon name="more" /></button
    >
    {#if shared}<span class="meta">{t('sharedUntil', { date: shortDate(shared.expiresAt) })}</span>{/if}
  {/if}
  {#if inside.length > 0}<span class="chip-gap"></span>{/if}
  {#each inside as f (f.id)}
    {@render chip(f as Folder)}
  {/each}
  <button class="chip chip-add" onclick={onnew}><Icon name="plus" />{t('newFolder')}</button>
</nav>
{#if open && editing.notes === open.id}
  <NotesField item={open} notes={open.notes} />
{:else if open?.notes}
  <p class="notes meta">{open.notes}</p>
{/if}

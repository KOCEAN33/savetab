<script lang="ts" module>
  /** Stroke paths on a 24px grid. An entry in FILLED is filled instead of stroked. */
  const PATHS = {
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
    settings:
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    theme: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 7l5 -2M12 12h9M12 17l5 2',
    transfer: 'M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4',
    close: 'M6 6l12 12M18 6L6 18',
    filter: 'M4 6h16M7 12h10M10 18h4',
    plus: 'M12 5v14M5 12h14',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.400 2.700 3.600 5.700 3.600 9s-1.200 6.300-3.600 9c-2.400-2.700-3.600-5.700-3.600-9S9.600 5.700 12 3z',
    chevron: 'M6 9l6 6 6-6',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
    more: 'M5 10.5a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zM12 10.5a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zM19 10.5a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3z',
    star: 'M12 3l2.7 5.6 6.1.8-4.5 4.300 1.100 6.100L12 16.900 6.600 19.800l1.100-6.100L3.200 9.400l6.100-.8z',
  } as const;

  const FILLED = new Set<IconName>(['more', 'star']);

  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name }: { name: IconName } = $props();
</script>

<svg class="icon" class:icon-filled={FILLED.has(name)} viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[name]} /></svg>

/** Drag reflow duration from DESIGN.md, zero when the user asks for reduced motion. */
export const FLIP_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150;

/** Replaces svelte-dnd-action's inline yellow outline with the `.drop-target` class. */
export const DROP_TARGET = { dropTargetStyle: {}, dropTargetClasses: ['drop-target'] };

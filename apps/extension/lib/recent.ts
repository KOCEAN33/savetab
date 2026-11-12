import { storage } from 'wxt/utils/storage';
import type { Id } from '@savetab/core';

const RECENT_MAX = 10;

/** Folders opened and groups that received tabs on this device, most recent first. */
export const recentItem = storage.defineItem<Id[]>('local:recent', { fallback: [] });

export async function touchRecent(id: Id): Promise<void> {
  const list = await recentItem.getValue();
  await recentItem.setValue([id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX));
}

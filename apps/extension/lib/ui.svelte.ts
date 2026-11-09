import type { Id } from '@savetab/core';
import { transact } from './db';

/** Which row has its title or notes editor open. One editor at a time across the page. */
export const editing = $state<{ title: Id | null; notes: Id | null }>({ title: null, notes: null });

/** Run a mutation from a UI event and show its error, such as a locked group refusing a change. */
export function act<T>(fn: Parameters<typeof transact<T>>[0]): Promise<T | undefined> {
  return transact(fn).catch((err) => {
    alert(err instanceof Error ? err.message : String(err));
    return undefined;
  });
}

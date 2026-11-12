import type { Hlc, Id, ItemRecord, Op } from './model';
import { mergeRemote } from './remote';
import { Tx, type ItemSource } from './tx';

/** In-memory adapter for tests and for code that runs outside a browser. */
export class MemoryStore implements ItemSource {
  readonly log: Op[] = [];
  private readonly records = new Map<Id, ItemRecord>();
  private clock: Hlc | null = null;

  constructor(private readonly deviceId: string) {}

  async get(id: Id) {
    return this.records.get(id);
  }

  async children(parentId: Id | null) {
    return [...this.records.values()].filter((r) => r.parentId === parentId);
  }

  async byUrl(url: string) {
    return [...this.records.values()].filter((r) => r.url === url);
  }

  all(): ItemRecord[] {
    return [...this.records.values()];
  }

  async trashed() {
    return [...this.records.values()].filter((r) => r.trashedAt != null && r.purged !== true);
  }

  async transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = new Tx(this, this.clock, this.deviceId);
    const result = await fn(tx);
    for (const r of tx.changed()) this.records.set(r.id, r);
    this.log.push(...tx.ops);
    this.clock = tx.clock;
    return result;
  }

  applyRemote(ops: Op[], receivedAt = Date.now()): Promise<void> {
    return this.transact((tx) =>
      mergeRemote(
        tx,
        ops.map((op) => ({ op, receivedAt })),
      ),
    );
  }
}

import { observe, tick } from './hlc';
import { applyOp } from './merge';
import type { Hlc, Id, ItemRecord, Op } from './model';
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

  async trashed() {
    return [...this.records.values()].filter((r) => r.trashedAt != null && r.purged !== true);
  }

  async transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let clock = this.clock;
    const tx = new Tx(this, () => (clock = tick(clock, Date.now(), this.deviceId)));
    const result = await fn(tx);
    for (const r of tx.changed()) this.records.set(r.id, r);
    this.log.push(...tx.ops);
    this.clock = clock;
    return result;
  }

  applyRemote(ops: Op[]): void {
    for (const op of ops) {
      this.records.set(op.itemId, applyOp(this.records.get(op.itemId) ?? { id: op.itemId, clocks: {} }, op));
      this.clock = observe(this.clock, op.hlc);
    }
  }
}

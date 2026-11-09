import { uuidv7 } from './id';
import { applyOp } from './merge';
import type { Hlc, Id, ItemRecord, Op } from './model';

/** Read access a storage adapter gives to mutations. Results include trashed and purged records. */
export interface ItemSource {
  get(id: Id): Promise<ItemRecord | undefined>;
  children(parentId: Id | null): Promise<ItemRecord[]>;
  byUrl(url: string): Promise<ItemRecord[]>;
  trashed(): Promise<ItemRecord[]>;
}

/**
 * One atomic local change. Reads see the transaction's own writes. The adapter persists
 * `changed()` and appends `ops` to the outbox in the same storage transaction.
 */
export class Tx implements ItemSource {
  readonly ops: Op[] = [];
  private readonly pending = new Map<Id, ItemRecord>();

  constructor(
    private readonly src: ItemSource,
    private readonly nextHlc: () => Hlc,
    readonly now: number = Date.now(),
  ) {}

  async get(id: Id): Promise<ItemRecord | undefined> {
    return this.pending.get(id) ?? (await this.src.get(id));
  }

  children(parentId: Id | null): Promise<ItemRecord[]> {
    return this.overlay(this.src.children(parentId), (r) => r.parentId === parentId);
  }

  byUrl(url: string): Promise<ItemRecord[]> {
    return this.overlay(this.src.byUrl(url), (r) => r.url === url);
  }

  trashed(): Promise<ItemRecord[]> {
    return this.overlay(this.src.trashed(), (r) => r.trashedAt != null && r.purged !== true);
  }

  async write(id: Id, fields: Record<string, unknown>): Promise<ItemRecord> {
    const op: Op = { opId: uuidv7(this.now), itemId: id, hlc: this.nextHlc(), fields };
    const next = applyOp((await this.get(id)) ?? { id, clocks: {} }, op);
    this.ops.push(op);
    this.pending.set(id, next);
    return next;
  }

  changed(): ItemRecord[] {
    return [...this.pending.values()];
  }

  private async overlay(base: Promise<ItemRecord[]>, keep: (r: ItemRecord) => boolean): Promise<ItemRecord[]> {
    const out = (await base).filter((r) => !this.pending.has(r.id));
    for (const r of this.pending.values()) if (keep(r)) out.push(r);
    return out;
  }
}

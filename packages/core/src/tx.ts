import { observe, tick } from './hlc';
import { uuidv7 } from './id';
import { applyOp } from './merge';
import { isSyncField, OP_VERSION, type Hlc, type Id, type ItemRecord, type Kind, type Op } from './model';

/** Read access a storage adapter gives to mutations. Results include trashed and purged records. */
export interface ItemSource {
  get(id: Id): Promise<ItemRecord | undefined>;
  children(parentId: Id | null): Promise<ItemRecord[]>;
  byUrl(url: string): Promise<ItemRecord[]>;
  trashed(): Promise<ItemRecord[]>;
}

/**
 * One atomic local change. Reads see the transaction's own writes. The adapter persists
 * `changed()` and `clock`, and appends `ops` to the outbox, in the same storage transaction.
 */
export class Tx implements ItemSource {
  readonly ops: Op[] = [];
  private readonly pending = new Map<Id, ItemRecord>();

  constructor(
    private readonly src: ItemSource,
    /** The device's clock. Starts from the stored value and moves with every write and merged op. */
    public clock: Hlc | null,
    private readonly deviceId: string,
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

  /** A local write. `fields` may hold `kind`, which a record needs on its first write. */
  async write(id: Id, { kind: given, ...fields }: Record<string, unknown>): Promise<ItemRecord> {
    const rec = (await this.get(id)) ?? { id, clocks: {} };
    const kind = rec.kind ?? (given as Kind | undefined);
    if (kind === undefined) throw new Error(`Item ${id} has no kind`);
    const bad = Object.keys(fields).find((f) => !isSyncField(kind, f));
    if (bad !== undefined) throw new Error(`Field ${bad} of a ${kind} does not sync`);
    this.clock = tick(this.clock, this.now, this.deviceId);
    return this.record(rec, { v: OP_VERSION, opId: uuidv7(this.now), itemId: id, kind, hlc: this.clock, fields });
  }

  /**
   * Write fields under the clock an earlier write gave them, and queue the op again. A restored
   * backup uses it, so its values lose to edits made after the backup was taken.
   */
  async replay(id: Id, kind: Kind, hlc: Hlc, fields: Record<string, unknown>): Promise<void> {
    const rec = (await this.get(id)) ?? { id, clocks: {} };
    this.clock = observe(this.clock, hlc);
    this.record(rec, { v: OP_VERSION, opId: uuidv7(this.now), itemId: id, kind, hlc, fields });
  }

  /** Apply an op from another device. It is not queued for upload. */
  async merge(op: Op): Promise<void> {
    const rec = (await this.get(op.itemId)) ?? { id: op.itemId, clocks: {} };
    this.pending.set(op.itemId, applyOp(rec, op));
    this.clock = observe(this.clock, op.hlc);
  }

  private record(rec: ItemRecord, op: Op): ItemRecord {
    const next = applyOp(rec, op);
    this.ops.push(op);
    this.pending.set(rec.id, next);
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

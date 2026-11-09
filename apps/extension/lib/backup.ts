import { storage } from 'wxt/utils/storage';
import { restoreSnapshot, type ItemRecord } from '@savetab/core';
import { db, transact } from './db';

export interface Backup {
  takenAt: number;
  /** Every item record, links and settings included. */
  records: ItemRecord[];
}

export const BACKUP_ALARM = 'weekly-backup';
export const BACKUP_PERIOD_MINUTES = 7 * 24 * 60;

/** Lives in `storage.local`, apart from IndexedDB, so it survives lost IndexedDB data. Uninstall clears both. */
export const backupItem = storage.defineItem<Backup | null>('local:backup', { fallback: null });

/** When the list was last restored from a backup, until the list page has shown it. */
export const restoredItem = storage.defineItem<number | null>('local:restoredFrom', { fallback: null });

export async function takeBackup(): Promise<void> {
  const records = (await db.items.toArray()).map(({ parentKey: _key, ...r }) => r as ItemRecord);
  await backupItem.setValue({ takenAt: Date.now(), records });
}

/** Write the backup back when IndexedDB holds no record but a backup does. */
export async function restoreIfLost(): Promise<void> {
  if ((await db.items.count()) > 0) return;
  const backup = await backupItem.getValue();
  if (!backup || backup.records.length === 0) return;
  await transact((tx) => restoreSnapshot(tx, backup.records));
  await restoredItem.setValue(backup.takenAt);
}

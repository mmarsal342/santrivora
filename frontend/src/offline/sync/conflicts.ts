import { db, type ConflictRecord } from '../db'

/**
 * Dipanggil push.ts pas satu item outbox balik dengan status:'conflict' —
 * cache lokal (baris entity-nya) SENGAJA TIDAK disentuh di sini (non-blocking
 * per keputusan user: staff tetap lihat/pakai versi mereka sendiri sampai
 * benar-benar dibuka & diresolusi lewat halaman /sync/conflicts, fase 21).
 */
export async function recordConflict(record: Omit<ConflictRecord, 'id'>): Promise<void> {
  await db.conflicts.add(record)
}

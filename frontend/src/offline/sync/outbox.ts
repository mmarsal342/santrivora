import { db } from '../db'

/**
 * Antri satu mutasi ke outbox — MENGGABUNGKAN (bukan menumpuk) kalau entity
 * yang sama (entityType+localId) sudah punya item pending, supaya:
 *  - create lalu diedit lagi sebelum sempat sync -> tetap SATU item 'create'
 *    dengan payload gabungan (bukan create+update terpisah yang bisa saling
 *    tabrakan version saat sync).
 *  - create lalu dibatalkan sebelum sempat sync -> outbox item dibuang total,
 *    gak pernah dikirim ke server sama sekali (item itu memang belum pernah
 *    ada di server).
 *  - update lalu diedit lagi sebelum sync -> payload digabung, version yang
 *    dipakai tetap version SAAT PERTAMA edit ini diantri (bukan di-refresh),
 *    karena itu yang backend butuhkan buat optimistic-concurrency check.
 *  - update lalu dihapus sebelum sync -> jadi satu item 'delete'.
 */
export async function enqueueOutbox(
  entityType: string,
  localId: string,
  action: 'create' | 'update' | 'delete',
  data: Record<string, unknown>,
  version = 0
): Promise<void> {
  const existing = await db.outbox.where('[entityType+localId]').equals([entityType, localId]).first()

  if (!existing) {
    await db.outbox.add({
      entityType,
      localId,
      action,
      data,
      version,
      status: 'pending',
      attempts: 0,
      nextRetryAt: null,
      createdAt: new Date().toISOString()
    })
    return
  }

  if (existing.action === 'create' && action === 'delete') {
    // Belum pernah sampai server — buang, gak usah dikirim sama sekali.
    await db.outbox.delete(existing.id!)
    return
  }

  const mergedAction = existing.action === 'create' ? 'create' : action
  const mergedData = action === 'delete' ? data : { ...existing.data, ...data }

  await db.outbox.update(existing.id!, {
    action: mergedAction,
    data: mergedData,
    status: 'pending',
    attempts: 0,
    nextRetryAt: null
  })
}

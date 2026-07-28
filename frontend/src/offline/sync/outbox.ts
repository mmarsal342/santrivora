import { db } from '../db'

/**
 * Antri satu mutasi ke outbox. Paling banyak DUA row pending per
 * (entityType, localId) sekaligus — satu 'create' dan satu 'update' — SENGAJA
 * TIDAK digabung jadi satu row 'create' (beda dari desain awal): create dan
 * update dikirim ke backend dengan SCHEMA ZOD YANG BEDA (createSchema vs
 * updateSchema, lihat src/lib/sync/entities/*.ts backend) — kolom yang cuma
 * ada di updateSchema (mis. jadwal_kegiatan.is_active, santri.status) DIAM-
 * DIAM DIBUANG kalau ikut kegabung ke payload create (zod strip field asing
 * tanpa error). Ketemu lewat kasus nyata: bikin jadwal_kegiatan offline lalu
 * langsung toggle nonaktif sebelum create sempat sync -> toggle-nya ilang
 * tanpa jejak.
 *
 * Aman dikirim sebagai DUA item terpisah karena push.ts selalu ngirim outbox
 * terurut createdAt ASC dalam SATU batch/panggilan /api/sync — backend proses
 * item satu-per-satu berurutan (bukan paralel), jadi create SELALU selesai
 * duluan sebelum update yang sama diproses, walau dari sudut pandang client
 * create itu "belum terkonfirmasi". Version yang dipakai update tetap valid
 * karena id-nya sudah permanen sejak awal (lihat catatan di useEntityMutation).
 *
 * Aturan gabung:
 *  - create + delete (belum pernah sync) -> buang SEMUA row terkait (create
 *    DAN update pending kalau ada), gak pernah dikirim ke server sama sekali.
 *  - create + update -> DUA row terpisah (bukan digabung, lihat alasan di atas).
 *  - update + update -> gabung jadi SATU row (sama-sama lewat updateSchema,
 *    gak ada risiko field asing). version yang dipakai tetap version SAAT
 *    PERTAMA edit ini diantri, bukan di-refresh tiap gabung.
 *  - update + delete -> buang update pending, jadi row 'delete'.
 */
export async function enqueueOutbox(
  entityType: string,
  localId: string,
  action: 'create' | 'update' | 'delete',
  data: Record<string, unknown>,
  version = 0
): Promise<void> {
  const existingRows = await db.outbox.where('[entityType+localId]').equals([entityType, localId]).toArray()
  const existingCreate = existingRows.find((r) => r.action === 'create')
  const existingUpdate = existingRows.find((r) => r.action === 'update')

  if (action === 'delete') {
    if (existingCreate) {
      // Belum pernah sampai server sama sekali — buang semuanya, gak usah
      // kirim delete kosong ke server.
      for (const r of existingRows) await db.outbox.delete(r.id!)
      return
    }
    if (existingUpdate) await db.outbox.delete(existingUpdate.id!)
    await db.outbox.add({
      entityType, localId, action: 'delete', data, version,
      status: 'pending', attempts: 0, nextRetryAt: null, createdAt: new Date().toISOString()
    })
    return
  }

  if (action === 'update') {
    if (existingUpdate) {
      await db.outbox.update(existingUpdate.id!, {
        data: { ...existingUpdate.data, ...data },
        status: 'pending', attempts: 0, nextRetryAt: null
      })
      return
    }
    await db.outbox.add({
      entityType, localId, action: 'update', data, version,
      status: 'pending', attempts: 0, nextRetryAt: null, createdAt: new Date().toISOString()
    })
    return
  }

  // action === 'create' — dua create beruntun buat localId yang sama gak
  // realistis di praktik (id di-generate sekali pas form disubmit), tapi
  // jaga-jaga: timpa payload create yang ada, jangan dobel.
  if (existingCreate) {
    await db.outbox.update(existingCreate.id!, { data: { ...existingCreate.data, ...data } })
    return
  }
  await db.outbox.add({
    entityType, localId, action: 'create', data, version,
    status: 'pending', attempts: 0, nextRetryAt: null, createdAt: new Date().toISOString()
  })
}

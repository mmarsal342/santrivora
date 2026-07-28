import { db } from '../db'
import { getEntityConfig } from '../registry'
import { enqueueOutbox } from '../sync/outbox'
import { requestPush } from '../sync/engine'

/**
 * SATU composable generik buat create/update/remove, dipakai entity
 * 'push-eligible' MAUPUN 'pull-only' — perilakunya bercabang otomatis dari
 * config.eligibility, view yang pakai gak perlu tahu/peduli bedanya:
 *  - 'push-eligible': tulis ke tabel entity + outbox dalam SATU transaksi
 *    Dexie (atomik, optimistic), push ke server di-debounce di background
 *    (lihat requestPush/flushOutbox). Id di-generate CLIENT-SIDE
 *    (crypto.randomUUID()) dan langsung dipakai sebagai id PERMANEN (dikirim
 *    juga sebagai data.id ke backend) — backend sudah dirancang menerima id
 *    dari client (lihat idempotentCreate di sync engine backend), jadi TIDAK
 *    ada "remap id lokal -> id server" yang perlu ditangani: id-nya sama
 *    sejak awal, baik dipakai sendiri maupun langsung direferensikan entity
 *    lain sebelum sempat online.
 *  - 'pull-only': langsung panggil service REST (butuh online), lalu cache
 *    lokal disinkronkan dengan hasilnya — dipakai entity yang tulisannya
 *    sengaja tetap online-only (kamar, kelas, kategori_pelanggaran, dst).
 */
export function useEntityMutation<T = Record<string, unknown>>(entityType: string) {
  const configOrNull = getEntityConfig(entityType)
  if (!configOrNull) throw new Error(`Entity "${entityType}" belum terdaftar di registry offline`)
  // Re-bind ke const baru: TS tidak mempertahankan narrowing `configOrNull`
  // (dari guard di atas) ke dalam function declaration di bawah (dianggap
  // bisa "dipanggil sebelum guard" karena hoisting) — `config` di sini sudah
  // pasti EntityConfig, bukan EntityConfig | undefined.
  const config = configOrNull
  const table = db.table(entityType)

  async function create(data: Record<string, unknown>): Promise<T> {
    if (config.eligibility === 'pull-only') {
      if (!config.service?.create) throw new Error(`${entityType}: service.create tidak tersedia`)
      const result = await config.service.create(data)
      await table.put(result)
      return result as T
    }

    const id = (data.id as string | undefined) || crypto.randomUUID()
    const row = { ...data, id, version: 1, updated_at: new Date().toISOString() } as unknown as T
    await db.transaction('rw', db.tables, async () => {
      await table.put(row)
      await enqueueOutbox(entityType, id, 'create', { ...data, id })
    })
    requestPush()
    return row
  }

  async function update(id: string, patch: Record<string, unknown>): Promise<void> {
    if (config.eligibility === 'pull-only') {
      if (!config.service?.update) throw new Error(`${entityType}: service.update tidak tersedia`)
      const result = await config.service.update(id, patch)
      await table.put(result)
      return
    }

    await db.transaction('rw', db.tables, async () => {
      const current = (await table.get(id)) as Record<string, unknown> | undefined
      if (!current) throw new Error(`${entityType} ${id} tidak ada di cache lokal`)
      const merged = { ...current, ...patch, updated_at: new Date().toISOString() }
      await table.put(merged)
      await enqueueOutbox(entityType, id, 'update', { id, ...patch }, current.version as number)
    })
    requestPush()
  }

  async function remove(id: string): Promise<void> {
    if (config.eligibility === 'pull-only') {
      if (!config.service?.remove) throw new Error(`${entityType}: service.remove tidak tersedia`)
      await config.service.remove(id)
      await table.delete(id)
      return
    }

    await db.transaction('rw', db.tables, async () => {
      const current = (await table.get(id)) as Record<string, unknown> | undefined
      const version = (current?.version as number) ?? 0
      // Kalau belum pernah sync SAMA SEKALI (masih 'create' pending di outbox),
      // baris ini gak pernah eksis di server — hapus beneran dari cache,
      // apapun config.softDelete-nya (enqueueOutbox di bawah bakal MEMBUANG
      // outbox item create itu, bukan mengirim delete kosong ke server).
      // Kalau SUDAH pernah sync (row lama / ada pending update), dan
      // entity-nya softDelete, JANGAN hard-delete lokal — update status-nya
      // secara optimistic (persis apa yang push.ts lakukan lagi setelah
      // sync sungguhan), biar filter status lokal (mis. 'keluar') tetap benar
      // tanpa nunggu pull ulang.
      const pending = await db.outbox.where('[entityType+localId]').equals([entityType, id]).first()
      const neverSynced = pending?.action === 'create'
      if (config.softDelete && !neverSynced) {
        if (current) await table.put({ ...current, [config.softDelete.column]: config.softDelete.setValue, updated_at: new Date().toISOString() })
      } else {
        await table.delete(id)
      }
      await enqueueOutbox(entityType, id, 'delete', { id }, version)
    })
    requestPush()
  }

  return { create, update, remove }
}

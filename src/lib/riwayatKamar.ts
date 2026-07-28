import type { Env } from '../types'

/**
 * Catat perubahan penempatan kamar santri: tutup span lama (kalau ada) dan
 * buka span baru (kalau ada kamar baru). No-op kalau kamar_id tidak berubah.
 * Dipanggil dari SEMUA jalur yang bisa mengubah santri.kamar_id — santri.ts
 * (create/update/bulk) dan sync.ts (push create/update, resolve conflict).
 */
export async function recordSantriKamarChange(
  env: Env,
  santriId: string,
  oldKamarId: string | null | undefined,
  newKamarId: string | null | undefined
): Promise<void> {
  const oldId = oldKamarId ?? null
  const newId = newKamarId ?? null
  if (oldId === newId) return

  if (oldId) {
    await env.DB.prepare(
      "UPDATE riwayat_kamar_santri SET selesai_at = datetime('now') WHERE santri_id = ? AND kamar_id = ? AND selesai_at IS NULL"
    ).bind(santriId, oldId).run()
  }
  if (newId) {
    await env.DB.prepare(
      'INSERT INTO riwayat_kamar_santri (id, santri_id, kamar_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), santriId, newId).run()
  }
}

/** Tutup semua span kamar yang masih terbuka untuk santri ini (dipakai saat santri keluar/lulus). */
export async function closeSantriKamarHistory(env: Env, santriId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE riwayat_kamar_santri SET selesai_at = datetime('now') WHERE santri_id = ? AND selesai_at IS NULL"
  ).bind(santriId).run()
}

/**
 * Catat perubahan penugasan wali kamar seorang personel: dipanggil dengan
 * daftar LENGKAP kamar_id lama vs baru (bukan delta), karena admin.ts
 * meng-assign wali kamar dengan pola "hapus semua, insert ulang".
 */
export async function recordPersonelKamarChange(
  env: Env,
  userId: string,
  oldKamarIds: string[],
  newKamarIds: string[]
): Promise<void> {
  const oldSet = new Set(oldKamarIds)
  const newSet = new Set(newKamarIds)
  const closed = oldKamarIds.filter((id) => !newSet.has(id))
  const opened = newKamarIds.filter((id) => !oldSet.has(id))

  for (const kamarId of closed) {
    await env.DB.prepare(
      "UPDATE riwayat_kamar_personel SET selesai_at = datetime('now') WHERE user_id = ? AND kamar_id = ? AND selesai_at IS NULL"
    ).bind(userId, kamarId).run()
  }
  for (const kamarId of opened) {
    await env.DB.prepare(
      'INSERT INTO riwayat_kamar_personel (id, user_id, kamar_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, kamarId).run()
  }
}

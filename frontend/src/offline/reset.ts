import { db } from './db'
import { pullableEntities } from './registry'
import { clearSince } from './sync/pull'

const OWNER_KEY = 'sync_owner'

/**
 * Kosongkan HANYA cache baca: tabel entity + cursor per-entity + watermark
 * `since`. `outbox`/`drafts`/`conflicts` SENGAJA dipertahankan — isinya kerjaan
 * user yang belum terkirim atau belum diputuskan, BUKAN turunan data server,
 * jadi menghapusnya sama dengan kehilangan data nyata (mis. ustadz input
 * absensi offline, sinyal jelek, lalu logout sebelum sempat ke-push).
 *
 * Dipakai di dua tempat: saat logout, dan saat scope user berubah (role/asrama
 * diubah admin). Membuang watermark itu INTI perbaikannya — tanpa itu, pull
 * berikutnya cuma minta "yang berubah sejak watermark lama", sementara data
 * yang baru jadi kelihatan karena scope melebar justru TIDAK berubah sejak
 * saat itu, jadi selamanya gak pernah dikirim (lihat sync/pull.ts).
 */
export async function resetReadCache(): Promise<void> {
  const entityTables = pullableEntities().map((c) => c.entityType)
  await db.transaction('rw', db.tables, async () => {
    for (const t of entityTables) await db.table(t).clear()
    await db.syncMeta.clear()
  })
  clearSince()
}

/**
 * Reset TOTAL termasuk `outbox`/`drafts`/`conflicts`. Dipakai HANYA saat device
 * berpindah pemilik (user id berbeda dari pemilik cache sebelumnya).
 *
 * Kenapa kerjaan yang belum terkirim harus dibuang di kasus ini, padahal
 * dipertahankan saat logout biasa: outbox milik user LAMA gak bisa di-push
 * pakai token user BARU — server bakal mencatatnya sebagai aksi user baru
 * (salah atribusi `dicatat_oleh`/`diajukan_oleh`, dan sebagian bakal ditolak
 * scope). Mengembalikannya ke pemilik aslinya juga gak mungkin dari device ini.
 * Jadi membuangnya adalah satu-satunya pilihan yang benar — dan itu sekaligus
 * menutup kebocoran cache antar-user di device yang dipakai bergantian.
 *
 * Balikin jumlah item outbox yang terpaksa dibuang, biar pemanggil bisa
 * memberi tahu user alih-alih menghapusnya diam-diam.
 */
export async function resetAllOfflineData(): Promise<number> {
  let discardedOutbox = 0
  await db.transaction('rw', db.tables, async () => {
    discardedOutbox = await db.outbox.count()
    for (const t of db.tables) await t.clear()
  })
  clearSince()
  return discardedOutbox
}

/** User id pemilik cache lokal saat ini (bertahan melewati logout — justru
 * itu gunanya: buat mendeteksi device dipakai akun lain di login berikutnya). */
export function getCacheOwner(): string | null {
  return localStorage.getItem(OWNER_KEY)
}

export function setCacheOwner(userId: string): void {
  localStorage.setItem(OWNER_KEY, userId)
}

import Dexie, { type Table } from 'dexie'
import './entities'
import { allEntities } from './registry'

export interface DraftRecord {
  draftKey: string
  data: unknown
  updatedAt: string
}

// Tabel data entity (kamar, santri, dst) diakses generik lewat
// `db.table(entityType)` oleh composable (useEntityList/useEntityMutation di
// fase POC) — SENGAJA tidak dideklarasikan sebagai properti bertipe di class
// ini, biar nambah entity baru gak perlu nyentuh file ini sama sekali (schema
// tabelnya sendiri sudah otomatis ke-generate dari registry di bawah).
// `drafts` dideklarasikan eksplisit karena diakses langsung by name dari
// useDraftPersistence, bukan lewat entityType dinamis.
class AppDatabase extends Dexie {
  drafts!: Table<DraftRecord, string>

  constructor() {
    super('santrivora')

    const entityStores: Record<string, string> = {}
    for (const cfg of allEntities()) {
      entityStores[cfg.entityType] = cfg.dexieSchema
    }

    // Catatan versi schema: karena app ini belum punya user/data production
    // sama sekali (lihat CLAUDE.md), entity baru boleh terus ditambah ke
    // version(1) ini tanpa perlu migrasi. BEGITU ada pemakaian nyata di
    // browser staff (data sudah tersimpan di IndexedDB mereka), penambahan
    // tabel/index baru wajib lewat version(2).stores({...schema lengkap
    // termasuk yang lama...}) — itu keterbatasan bawaan IndexedDB (bukan
    // sesuatu yang bisa dihindari desain apa pun), bukan alasan untuk
    // membangun sistem migrasi versi sebelum benar-benar dibutuhkan.
    this.version(1).stores({
      ...entityStores,
      drafts: '&draftKey, updatedAt'
    })
  }
}

export const db = new AppDatabase()

// Buka koneksi eksplisit saat app start, jangan nunggu operasi pertama —
// biar error schema (misal dua entity kebetulan pakai entityType yang sama
// jadi tabrakan nama tabel) langsung keliatan dari awal, bukan baru muncul
// pas composable pertama kali query nanti.
db.open().catch((err) => {
  console.error('[offline/db] gagal membuka database lokal:', err)
})

import Dexie, { type Table } from 'dexie'
import './entities'
import { allEntities } from './registry'

export interface DraftRecord {
  draftKey: string
  data: unknown
  updatedAt: string
}

export interface OutboxItem {
  id?: number
  entityType: string
  localId: string
  action: 'create' | 'update' | 'delete'
  data: Record<string, unknown>
  /** Version yang diketahui client SEBELUM mutasi ini (dipakai backend buat
   * optimistic-concurrency check pas update/delete). Diabaikan backend saat create. */
  version: number
  status: 'pending' | 'error'
  attempts: number
  nextRetryAt: string | null
  lastError?: string
  createdAt: string
}

export interface ConflictRecord {
  id?: number
  entityType: string
  localId: string
  action: 'create' | 'update' | 'delete'
  clientData: Record<string, unknown>
  serverData: Record<string, unknown>
  serverVersion: number
  detectedAt: string
}

export interface SyncMetaRecord {
  entityType: string
  /** Cursor buat lanjutin HALAMAN pull yang lagi berjalan (di-reset null tiap
   * kali satu window pull selesai — lihat sync/pull.ts). */
  cursor: string | null
}

// Tabel data entity (kamar, santri, dst) diakses generik lewat
// `db.table(entityType)` oleh composable (useEntityList/useEntityMutation) —
// SENGAJA tidak dideklarasikan sebagai properti bertipe di class ini, biar
// nambah entity baru gak perlu nyentuh file ini sama sekali (schema tabelnya
// sendiri sudah otomatis ke-generate dari registry di bawah). Tabel lain di
// bawah dideklarasikan eksplisit karena diakses by name (bukan lewat
// entityType dinamis) oleh sync engine/composable.
class AppDatabase extends Dexie {
  drafts!: Table<DraftRecord, string>
  outbox!: Table<OutboxItem, number>
  conflicts!: Table<ConflictRecord, number>
  syncMeta!: Table<SyncMetaRecord, string>

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
      drafts: '&draftKey, updatedAt',
      outbox: '++id, [entityType+localId], status, nextRetryAt, createdAt',
      conflicts: '++id, entityType, localId, detectedAt',
      syncMeta: '&entityType'
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

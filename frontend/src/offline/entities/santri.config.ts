import { registerEntity, type EntityConfig } from '../registry'

// Entity kedua yang terdaftar, dan yang pertama push-eligible (POC fase 20) —
// mirror backend fase 0. `service` sengaja tidak diisi: santri push-eligible
// artinya create/update/remove SELALU lewat outbox + /api/sync, bukan lewat
// santriService langsung (lihat useEntityMutation) — kecuali dropdown/lookup
// murni yang belum dimigrasi (kelas di SantriFormView, masih network-only
// sampai gelombang 1 memigrasi entity kelas).
export const santriEntityConfig: EntityConfig = {
  entityType: 'santri',
  dexieSchema: '&id, kelas_id, kamar_id, jenis_kelamin, status, updated_at, nama_lengkap',
  eligibility: 'push-eligible',
  // Mirror backend santriSyncConfig.softDelete — "hapus" santri offline SET
  // status='keluar' di server (bukan hard-delete), jadi cache lokal juga
  // harus di-update jadi 'keluar' (bukan dihapus dari Dexie) biar filter
  // status='keluar'/'semua' di SantriListView tetap akurat tanpa nunggu pull.
  softDelete: { column: 'status', setValue: 'keluar' }
}

registerEntity(santriEntityConfig)

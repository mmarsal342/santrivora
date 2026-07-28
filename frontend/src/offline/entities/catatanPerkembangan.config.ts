import { registerEntity, type EntityConfig } from '../registry'

// push-eligible, mirror backend catatanPerkembanganSyncConfig — scope
// 'via-santri' (sama seperti catatan_disiplin, ustadz akses lewat
// kelas/kamar santri terkait). dicatat_oleh (uuid) tetap disimpan di baris
// tapi TIDAK di-resolve ke nama di tampilan — sama alasannya seperti
// catatan_disiplin: users/personel gak pernah masuk sync cache.
export const catatanPerkembanganEntityConfig: EntityConfig = {
  entityType: 'catatan_perkembangan',
  dexieSchema: '&id, santri_id, tanggal, kategori, is_deleted, updated_at',
  eligibility: 'push-eligible',
  softDelete: { column: 'is_deleted', setValue: 1 }
}

registerEntity(catatanPerkembanganEntityConfig)

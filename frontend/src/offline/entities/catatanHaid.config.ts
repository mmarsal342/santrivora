import { registerEntity, type EntityConfig } from '../registry'

// push-eligible, mirror backend catatanHaidSyncConfig — naturalKey
// santri_id+tanggal (upsert per hari, lihat catatanHaid.ts). KYAI SENGAJA
// gak bisa lihat baris individual sama sekali (haidAccessCheck backend
// blokir total, beda dari catatan_disiplin/catatan_perkembangan) — pull
// buat kyai bakal dapet changeset kosong entity ini, itu BENAR bukan bug
// (lihat dashboard §A.8 yang kasih kyai angka agregat doang).
export const catatanHaidEntityConfig: EntityConfig = {
  entityType: 'catatan_haid',
  dexieSchema: '&id, santri_id, tanggal, is_deleted, updated_at',
  eligibility: 'push-eligible',
  softDelete: { column: 'is_deleted', setValue: 1 }
}

registerEntity(catatanHaidEntityConfig)

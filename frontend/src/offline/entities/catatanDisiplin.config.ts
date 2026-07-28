import { registerEntity, type EntityConfig } from '../registry'

// push-eligible (mirror backend fase 0) — create/update/delete lewat outbox.
// softDelete mirror backend: DELETE cuma set is_deleted=1 (tombstone, tetap
// ke-pull biar cache lokal client lain ikut ke-update — excludeFromFetch di
// backend cuma soal write-path idempotency, gak mempengaruhi visibilitas
// pull sama sekali).
export const catatanDisiplinEntityConfig: EntityConfig = {
  entityType: 'catatan_disiplin',
  dexieSchema: '&id, santri_id, tipe, kategori_id, tanggal_kejadian, is_deleted, updated_at',
  eligibility: 'push-eligible',
  softDelete: { column: 'is_deleted', setValue: 1 }
}

registerEntity(catatanDisiplinEntityConfig)

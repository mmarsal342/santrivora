import { registerEntity, type EntityConfig } from '../registry'

// push-eligible (mirror backend fase 2) — create/update/delete lewat outbox.
// softDelete mirror backend: DELETE cuma set is_active=0 (instance kegiatan
// yang sudah ke-materialize dari jadwal ini TIDAK terhapus, cuma jadwal-nya
// yang berhenti bikin instance baru mulai besok).
export const jadwalKegiatanEntityConfig: EntityConfig = {
  entityType: 'jadwal_kegiatan',
  dexieSchema: '&id, kelas_id, kamar_id, is_active, urutan, updated_at',
  eligibility: 'push-eligible',
  softDelete: { column: 'is_active', setValue: 0 }
}

registerEntity(jadwalKegiatanEntityConfig)

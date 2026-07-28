import { registerEntity, type EntityConfig } from '../registry'

// Backend-nya push-eligible ('full', natural-key upsert) — tapi di frontend
// gelombang 2 SENGAJA cuma dipakai buat BACA (roster harian di
// AbsensiHarianView). Submit (bulkMark) TETAP langsung ke absensiService
// REST seperti sebelumnya (aksi batch sadar sekali-klik, bukan aliran
// mutasi independen — sesuai plan §B.3), makanya `eligibility: 'pull-only'`
// di sini TANPA `service` (gak pernah dipakai lewat useEntityMutation sama
// sekali, cuma cache buat useEntityList).
export const absensiEntityConfig: EntityConfig = {
  entityType: 'absensi',
  dexieSchema: '&id, santri_id, tanggal, kegiatan_id, updated_at',
  eligibility: 'pull-only'
}

registerEntity(absensiEntityConfig)

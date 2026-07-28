import { registerEntity, type EntityConfig } from '../registry'

// push-eligible — SATU-satunya entity yang pakai TransitionRule backend
// (approve/tolak/kembali). Dari sisi frontend transisi ini dikirim sebagai
// action:'update' BIASA dengan data:{status:<target>, ...writeFields} —
// backend yang mendeteksi sendiri lewat transitions[] (lihat
// perizinanPulang.ts), gak ada primitif baru yang dibutuhkan di
// useEntityMutation, update() yang sudah ada cukup (mirror rencana §B.8).
// editGuard backend (edit/batalkan cuma boleh selama status='diajukan')
// otomatis ikut ditegakkan lewat jalur update/delete generik yang sama,
// gak perlu logic tambahan di sini.
export const perizinanPulangEntityConfig: EntityConfig = {
  entityType: 'perizinan_pulang',
  dexieSchema: '&id, santri_id, status, tanggal_keluar, is_deleted, updated_at',
  eligibility: 'push-eligible',
  softDelete: { column: 'is_deleted', setValue: 1 }
}

registerEntity(perizinanPulangEntityConfig)

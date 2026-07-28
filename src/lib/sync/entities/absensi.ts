import { z } from 'zod'
import { canAccessKamar } from '../../scope'
import type { EntitySyncConfig } from '../types'

const absensiCreateSchema = z.object({
  id: z.string().optional(),
  santri_id: z.string().uuid(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kegiatan_id: z.string().uuid().nullable().optional(),
  status: z.enum(['hadir', 'sakit', 'izin', 'alpa']),
  keterangan: z.string().max(500).nullable().optional()
})

const absensiUpdateSchema = z.object({
  id: z.string().optional(),
  status: z.enum(['hadir', 'sakit', 'izin', 'alpa']).optional(),
  keterangan: z.string().max(500).nullable().optional()
})

export const absensiSyncConfig: EntitySyncConfig = {
  entityType: 'absensi',
  table: 'absensi',
  capability: 'full',
  idempotentCreate: false,
  // Natural-key upsert — mirror ON CONFLICT(santri_id, tanggal, COALESCE(kegiatan_id,''))
  // yang sudah ada di absensi.ts POST /bulk. Sengaja TANPA optimistic-concurrency
  // di jalur create (last-write-wins), demi paritas perilaku dengan endpoint itu.
  naturalKey: ['santri_id', 'tanggal', 'kegiatan_id'],
  naturalKeyNullable: ['kegiatan_id'],
  // Belum ada endpoint hapus absensi sama sekali (absensi.ts cuma punya POST
  // /bulk + PUT /:id) — sengaja tidak diaktifkan lewat sync juga di fase ini.
  disabledActions: ['delete'],
  createColumns: ['santri_id', 'tanggal', 'kegiatan_id', 'status', 'keterangan'],
  createExtra: (_data, user) => ({ dicatat_oleh: user.sub }),
  createSchema: absensiCreateSchema,
  updateSchema: absensiUpdateSchema,
  writableColumns: ['status', 'keterangan'],
  // Absensi berbasis KAMAR murni (wali kamar) — TIDAK ada dimensi kelas sama
  // sekali, beda dari catatan_disiplin. Pakai 'custom' karena 'via-santri'
  // bawaan mengizinkan viaKelas ATAU viaKamar, sedangkan absensi cuma kamar.
  scope: {
    kind: 'custom',
    check: async (env, user, row) => {
      const santriId = row.santri_id as string | undefined
      if (!santriId) return false
      const santri = await env.DB.prepare('SELECT kamar_id FROM santri WHERE id = ?').bind(santriId).first<{ kamar_id: string | null }>()
      if (!santri) return false
      if (user.role === 'admin' || user.role === 'kyai') return true
      if (user.role === 'kepala_asrama') return canAccessKamar(env, user, santri.kamar_id)
      return !!santri.kamar_id && user.kamar_ids.includes(santri.kamar_id)
    }
  },
  scopeDeniedCode: 'KAMAR_NOT_ASSIGNED',
  notFoundCode: 'ABSENSI_NOT_FOUND',
  refValidations: [
    { column: 'kegiatan_id', refTable: 'kegiatan', refActiveColumn: 'is_active', notFoundCode: 'KEGIATAN_NOT_FOUND' }
  ],
  pull: { timestampColumn: 'updated_at' }
}

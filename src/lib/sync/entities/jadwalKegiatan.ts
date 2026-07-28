import { z } from 'zod'
import type { EntitySyncConfig } from '../types'

const jadwalKegiatanCreateSchema = z.object({
  id: z.string().optional(),
  nama: z.string().min(1).max(200),
  jenis: z.string().max(50).nullable().optional(),
  urutan: z.number().int().min(0).max(999).optional(),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional()
})

const jadwalKegiatanUpdateSchema = z.object({
  id: z.string().optional(),
  nama: z.string().min(1).max(200).optional(),
  jenis: z.string().max(50).nullable().optional(),
  urutan: z.number().int().min(0).max(999).optional(),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional(),
  is_active: z.number().int().optional()
})

export const jadwalKegiatanSyncConfig: EntitySyncConfig = {
  entityType: 'jadwal_kegiatan',
  table: 'jadwal_kegiatan',
  capability: 'full',
  idempotentCreate: true,
  createColumns: ['nama', 'jenis', 'urutan', 'kelas_id', 'kamar_id'],
  createExtra: (_data, user) => ({ created_by: user.sub }),
  createSchema: jadwalKegiatanCreateSchema,
  updateSchema: jadwalKegiatanUpdateSchema,
  writableColumns: ['nama', 'jenis', 'urutan', 'kelas_id', 'kamar_id', 'is_active'],
  softDelete: { column: 'is_active', setValue: 0 },
  // GET /api/jadwal-kegiatan tidak dibatasi role sama sekali (semua staff lihat
  // jadwal yang sama) — tapi POST/PUT/DELETE khusus admin (requireRole('admin')).
  scope: { kind: 'global' },
  writeScope: { kind: 'role-only', roles: ['admin'] },
  targetScope: { kind: 'role-only', roles: ['admin'] },
  scopeDeniedCode: 'INSUFFICIENT_PERMISSIONS',
  notFoundCode: 'JADWAL_KEGIATAN_NOT_FOUND',
  pull: { timestampColumn: 'updated_at' }
}

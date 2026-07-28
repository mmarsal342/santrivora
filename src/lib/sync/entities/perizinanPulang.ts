import { z } from 'zod'
import type { Env, UserPayload } from '../../../types'
import type { EntitySyncConfig } from '../types'

const perizinanCreateSchema = z.object({
  id: z.string().optional(),
  santri_id: z.string().uuid(),
  tanggal_keluar: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  perkiraan_kembali: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  alasan: z.string().min(1).max(500)
}).refine((data) => !data.perkiraan_kembali || data.perkiraan_kembali >= data.tanggal_keluar, {
  message: 'Perkiraan kembali tidak boleh sebelum tanggal keluar.',
  path: ['perkiraan_kembali']
})

// Satu updateSchema menaungi baik edit biasa (tanggal_keluar/perkiraan_kembali/
// alasan, cuma boleh selama status='diajukan' — lihat editGuard) MAUPUN
// transisi status (approve/tolak/kembali dikirim sebagai update biasa dengan
// data:{status:<target>, ...}) — lihat TransitionRule di bawah. `status`
// SENGAJA cuma terima target transisi yang valid (bukan 'diajukan' — gak ada
// transisi balik ke situ), jadi status acak ditolak di level validasi schema.
const perizinanUpdateSchema = z.object({
  id: z.string().optional(),
  tanggal_keluar: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  perkiraan_kembali: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  alasan: z.string().min(1).max(500).optional(),
  status: z.enum(['disetujui', 'ditolak', 'selesai']).optional(),
  catatan_keputusan: z.string().max(500).nullable().optional(),
  tanggal_kembali_aktual: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

// Mirror assertApprovalAccess di perizinan.ts — LEBIH SEMPIT dari scope dasar
// (assertAccess/via-santri): cuma admin (global) dan kepala_asrama (asramanya
// sendiri) yang boleh approve/tolak. Ustadz boleh mengajukan tapi bukan yang
// menyetujui — itu tujuan alur approval berjenjang.
async function approvalScopeCheck(env: Env, user: UserPayload, row: Record<string, unknown>): Promise<boolean> {
  const santriId = row.santri_id as string
  const santri = await env.DB.prepare('SELECT kamar_id FROM santri WHERE id = ?').bind(santriId).first<{ kamar_id: string | null }>()
  const kamarId = santri?.kamar_id ?? null
  if (user.role === 'admin') return true
  if (user.role === 'kepala_asrama') {
    if (!kamarId || !user.asrama_jenis) return false
    const k = await env.DB.prepare('SELECT jenis_kelamin FROM kamar WHERE id = ? AND is_active = 1').bind(kamarId).first<{ jenis_kelamin: string }>()
    return !!k && k.jenis_kelamin === user.asrama_jenis
  }
  return false
}

export const perizinanPulangSyncConfig: EntitySyncConfig = {
  entityType: 'perizinan_pulang',
  table: 'perizinan_pulang',
  capability: 'full',
  idempotentCreate: false,
  createColumns: ['santri_id', 'tanggal_keluar', 'perkiraan_kembali', 'alasan'],
  createExtra: (_data, user) => ({ diajukan_oleh: user.sub }),
  createSchema: perizinanCreateSchema,
  updateSchema: perizinanUpdateSchema,
  // Whitelist EDIT BIASA saja (selama status='diajukan') — status/disetujui_
  // oleh/catatan_keputusan/tanggal_kembali_aktual SENGAJA tidak di sini,
  // cuma reachable lewat transitions[].writeFields/extra di bawah. Ini yang
  // mencegah client menyelundupkan perubahan status lewat "edit biasa".
  writableColumns: ['tanggal_keluar', 'perkiraan_kembali', 'alasan'],
  softDelete: { column: 'is_deleted', setValue: 1, excludeFromFetch: true },
  // Sama seperti assertAccess: admin/kyai global (baca), kepala_asrama asrama
  // sendiri, ustadz via kelas/kamar santri.
  scope: { kind: 'via-santri', santriIdColumn: 'santri_id' },
  scopeDeniedCode: 'NOT_ASSIGNED',
  notFoundCode: 'PERIZINAN_NOT_FOUND',
  // Edit biasa (bukan transisi) cuma boleh selama masih 'diajukan' — mirror
  // guard WHERE status='diajukan' yang sudah ada di PUT/DELETE perizinan.ts.
  editGuard: { field: 'status', values: ['diajukan'], invalidCode: 'NOT_DIAJUKAN' },
  // Cross-field date-ordering — dua skenario beda field, satu fungsi:
  // edit biasa (perkiraan_kembali vs tanggal_keluar) ATAU transisi kembali
  // (tanggal_kembali_aktual vs tanggal_keluar, tanggal_keluar-nya dari current
  // karena tidak ikut diedit di transisi ini).
  validateMerged: (current, patch) => {
    if (patch.perkiraan_kembali !== undefined || patch.tanggal_keluar !== undefined) {
      const tanggalKeluar = (patch.tanggal_keluar ?? current.tanggal_keluar) as string
      const perkiraanKembali = patch.perkiraan_kembali !== undefined ? patch.perkiraan_kembali : current.perkiraan_kembali
      if (perkiraanKembali && (perkiraanKembali as string) < tanggalKeluar) return 'TANGGAL_KEMBALI_INVALID'
    }
    if (patch.tanggal_kembali_aktual !== undefined) {
      if ((patch.tanggal_kembali_aktual as string) < (current.tanggal_keluar as string)) return 'TANGGAL_KEMBALI_INVALID'
    }
    return null
  },
  transitions: [
    {
      field: 'status',
      from: ['diajukan'],
      to: 'disetujui',
      scope: { kind: 'custom', check: approvalScopeCheck },
      invalidTransitionCode: 'NOT_DIAJUKAN',
      writeFields: ['catatan_keputusan'],
      extra: (_patch, user) => ({ disetujui_oleh: user.sub })
    },
    {
      field: 'status',
      from: ['diajukan'],
      to: 'ditolak',
      scope: { kind: 'custom', check: approvalScopeCheck },
      invalidTransitionCode: 'NOT_DIAJUKAN',
      writeFields: ['catatan_keputusan'],
      extra: (_patch, user) => ({ disetujui_oleh: user.sub }),
      // tolak WAJIB menyertakan catatan_keputusan (beda dari approve yang opsional).
      validate: (patch) => {
        const catatan = patch.catatan_keputusan
        return typeof catatan === 'string' && catatan.trim().length > 0 ? null : 'CATATAN_KEPUTUSAN_REQUIRED'
      }
    },
    {
      field: 'status',
      from: ['disetujui'],
      to: 'selesai',
      // Scope kembali SAMA seperti scope dasar (assertAccess) — siapa saja
      // yang punya akses ke santri ini, BUKAN cuma admin/kepala_asrama.
      scope: { kind: 'via-santri', santriIdColumn: 'santri_id' },
      invalidTransitionCode: 'NOT_DISETUJUI',
      writeFields: ['tanggal_kembali_aktual'],
      afterWrite: async (env, id, before, after, user) => {
        // Catatkan juga ke catatan_perkembangan santri — mirror perilaku yang
        // sudah ada di perizinan.ts POST /:id/kembali. dicatat_oleh = user
        // yang menandai kembali (bukan yang mengajukan/menyetujui).
        await env.DB.prepare(
          `INSERT INTO catatan_perkembangan (id, santri_id, tanggal, kategori, judul, catatan, dicatat_oleh)
           VALUES (?, ?, ?, 'Keluarga', 'Izin Pulang', ?, ?)`
        ).bind(
          crypto.randomUUID(),
          before.santri_id,
          before.tanggal_keluar,
          `${before.alasan} (keluar ${before.tanggal_keluar}, kembali ${after.tanggal_kembali_aktual})`,
          user.sub
        ).run()
      }
    }
  ],
  pull: { timestampColumn: 'updated_at' }
}

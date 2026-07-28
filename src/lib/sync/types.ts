import { z } from 'zod'
import type { Env, Role, UserPayload } from '../../types'

export type SyncCapability = 'full' | 'pull-only' | 'none'

/**
 * Aturan deklaratif "siapa boleh baca/tulis baris ini". Dieksekusi oleh
 * scopeDispatch.ts di atas primitif scope.ts (resolveKamarScope/canAccessKamar/
 * resolveKelasScope/canAccessKelas) — entity config TIDAK menulis pengecekan
 * scope bespoke sendiri kecuali lewat 'custom'.
 */
export type ScopeRule =
  | { kind: 'global' }
  // kelasColumn/kamarColumn: undefined -> default 'kelas_id'/'kamar_id' (kolom
  // ADA di tabel entity, cuma pakai nama default). null -> dimensi itu MEMANG
  // TIDAK ADA sama sekali di entity ini (mis. tabel kelas tidak punya kolom
  // kamar_id) — beda dari undefined, supaya tidak salah bikin SQL merujuk
  // kolom yang tidak exist.
  | { kind: 'direct-kamar-kelas'; kelasColumn?: string | null; kamarColumn?: string | null }
  | { kind: 'via-santri'; santriIdColumn: string }
  | { kind: 'role-only'; roles: Role[] }
  | { kind: 'custom'; check: (env: Env, user: UserPayload, row: Record<string, unknown>) => Promise<boolean> }

/**
 * Validasi FK generik, mereplikasi validateSantriRefs/validatePartialSantriRefs/
 * validateKategoriRef sekaligus. `column` adalah kolom FK di tabel entity ini.
 * `watchColumns` (default [column]) menentukan kolom APA SAJA yang perubahannya
 * memicu re-validasi ref ini pada UPDATE PARSIAL — dipakai untuk kasus kamar_id:
 * gender-crosscheck-nya bergantung juga pada jenis_kelamin, bukan cuma kamar_id
 * itu sendiri (lihat validatePartialSantriRefs yang lama).
 * `existenceTrigger` menentukan kapan exists+active check dijalankan:
 *  - 'changed' (default): hanya kalau `column` itu sendiri BENAR-BENAR berubah
 *    dari current row (mencegah kamar/kelas yang belakangan dinonaktifkan
 *    mem-brick edit lain yang tidak menyentuhnya).
 *  - 'present': setiap kali field itu ada di payload, terlepas dari berubah atau
 *    tidak (dipakai kategori_id — perilaku asli tidak membandingkan ke current).
 */
export interface RefValidation {
  column: string
  refTable: string
  refActiveColumn?: string
  notFoundCode: string
  watchColumns?: string[]
  existenceTrigger?: 'changed' | 'present'
  when?: (effective: Record<string, unknown>) => boolean
  crossCheck?: (refRow: Record<string, unknown>, effective: Record<string, unknown>) => string | null
}

/**
 * Dukungan entity berbasis state-machine (perizinan_pulang) TANPA menambah
 * action baru di push protocol (action tetap cuma create|update|delete). Sebuah
 * transisi status (approve/tolak/kembali) dikirim client sebagai action:'update'
 * dengan data:{status:<target>, ...}. Engine mendeteksi field yang cocok dengan
 * salah satu TransitionRule dan menjalankan aturan itu MENGGANTI (bukan
 * menambah di atas) scope rule dasar entity untuk request ini.
 */
export interface TransitionRule {
  field: string
  from: string[]
  to: string
  scope: ScopeRule
  invalidTransitionCode: string
  afterWrite?: (
    env: Env,
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ) => Promise<void>
}

export interface EntitySyncConfig {
  entityType: string
  table: string
  capability: SyncCapability
  idColumn?: string
  /** contoh absensi: ['santri_id','tanggal','kegiatan_id'] → upsert-on-create */
  naturalKey?: string[]
  /** kolom di naturalKey yang nullable — dicocokkan pakai COALESCE(col,'') = COALESCE(?,''). */
  naturalKeyNullable?: string[]
  /** action push yang sengaja belum didukung entity ini (mis. absensi belum ada endpoint delete). */
  disabledActions?: Array<'create' | 'update' | 'delete'>
  /**
   * Role yang diblokir MUTLAK dari create/update/delete/resolve entity ini,
   * TERLEPAS dari hasil scope check (mirror requireCanMutate() yang dulu
   * dipasang di level route /api/sync). Default ['kyai'] kalau tidak diisi —
   * kyai read-only di hampir semua entity. Entity yang SENGAJA mengizinkan
   * kyai menulis (mis. catatan_personel — kyai salah satu penulis utama)
   * override jadi [] di config-nya sendiri.
   */
  readOnlyRoles?: Role[]
  createSchema: z.ZodType<any>
  updateSchema: z.ZodType<any>
  /** SATU whitelist, dipakai push-update DAN conflict-resolve merged_data */
  writableColumns: string[]
  /**
   * Kolom yang di-INSERT eksplisit saat create (dengan fallback null kalau tidak
   * dikirim client) — default writableColumns kalau tidak diisi. Dipisah dari
   * writableColumns karena beberapa kolom whitelist-update (misal santri.status)
   * SENGAJA tidak di-insert saat create (biar DB DEFAULT yang berlaku).
   */
  createColumns?: string[]
  /** Kolom tambahan yang nilainya BUKAN dari payload client (misal dicatat_oleh: user.sub). */
  createExtra?: (data: Record<string, unknown>, user: UserPayload) => Record<string, unknown>
  /** Kalau true: create dengan server-id yang sudah ada di DB dianggap sukses (retry-safe), bukan error. */
  idempotentCreate?: boolean
  /**
   * Hanya relevan untuk scope kind 'via-santri': tolak create kalau santri induk
   * berstatus bukan 'aktif' (mis. catatan_disiplin tidak boleh dibuat untuk
   * santri yang sudah lulus/keluar).
   */
  requireActiveParent?: boolean
  softDelete?: { column: string; setValue: unknown; excludeFromFetch?: boolean }
  scope: ScopeRule
  /** Kode error 403 dipakai saat checkScopeRule gagal (read/write access ke baris existing). */
  scopeDeniedCode: string
  /** Kode error 404 dipakai saat baris dengan id tsb tidak ditemukan (update/delete/resolve). */
  notFoundCode: string
  /** default = scope, kalau target write (kelas/kamar tujuan) punya aturan beda */
  targetScope?: ScopeRule
  /**
   * default = scope untuk UPDATE/DELETE/RESOLVE (baris yang sudah ada) — dipakai
   * kalau otorisasi tulis LEBIH KETAT dari otorisasi baca (mis. kegiatan: siapa
   * saja di kelas/kamar itu boleh BACA, tapi cuma admin/kyai/pembuat/kepala_asrama
   * yang boleh UBAH/HAPUS).
   */
  writeScope?: ScopeRule
  /**
   * Override create-time authorization SEPENUHNYA — dipakai kalau butuh lebih
   * dari satu kode error berbeda (bukan cuma satu scopeDeniedCode generik).
   * Kalau diisi, MENGGANTI checkTargetScopeRule/checkScopeRule biasa saat create.
   * Return null = boleh, return string = kode error.
   */
  customCreateCheck?: (env: Env, user: UserPayload, data: Record<string, unknown>) => Promise<string | null>
  /**
   * Override otorisasi UPDATE/DELETE/RESOLVE (baris existing) sepenuhnya —
   * dipakai kalau aturannya lebih rumit dari satu ScopeRule (mis. kegiatan:
   * creator-override + kepala_asrama-current-access dengan kode error sendiri).
   * Kalau diisi, MENGGANTI checkScopeRule/writeScope biasa.
   */
  customWriteCheck?: (env: Env, user: UserPayload, current: Record<string, unknown>) => Promise<string | null>
  refValidations?: RefValidation[]
  transitions?: TransitionRule[]
  afterWrite?: (
    env: Env,
    action: 'create' | 'update' | 'delete',
    id: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null
  ) => Promise<void>
  pull: {
    timestampColumn: string
    selectExtra?: string
    joinExtra?: string
  }
}

export interface PushItem {
  entity_type: string
  local_id: string
  action: 'create' | 'update' | 'delete'
  data: Record<string, unknown>
  version: number
}

export interface PushResult {
  local_id: string
  status: 'synced' | 'conflict' | 'error'
  server_id?: string
  server_version?: number
  error?: string
  conflict?: {
    type: string
    server_data: Record<string, unknown>
    server_version: number
  }
}

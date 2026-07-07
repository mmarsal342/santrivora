export interface Env {
  // Required environment variables
  JWT_ACCESS_SECRET: string
  JWT_REFRESH_SECRET: string
  ENVIRONMENT: 'development' | 'staging' | 'production'

  // Bindings
  DB: D1Database
  KV: KVNamespace
  R2: R2Bucket
  ASSETS: Fetcher

  // Optional
  SENTRY_DSN?: string
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error'
  ADMIN_EMAIL?: string
  PESANTREN_NAME?: string
}

export interface UserPayload {
  sub: string
  email: string
  role: 'admin' | 'ustadz'
  kelas_ids: string[]
  kamar_ids: string[]
  iat: number
  exp: number
  jti: string
}

export interface Santri {
  id: string
  nama_lengkap: string
  jenis_kelamin: 'L' | 'P'
  kelas_id: string | null
  kamar_id: string | null
  angkatan: string | null
  tanggal_masuk: string | null
  status: 'aktif' | 'lulus' | 'keluar'
  foto_url: string | null
  tanggal_lahir: string | null
  love_language: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface Kamar {
  id: string
  nama: string
  jenis_kelamin: 'L' | 'P'
  kapasitas: number | null
  is_active: number
  created_at: string
  updated_at: string
}

export interface Kegiatan {
  id: string
  nama: string
  jenis: string | null
  tanggal: string
  kelas_id: string | null
  kamar_id: string | null
  is_active: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface Absensi {
  id: string
  santri_id: string
  tanggal: string
  kegiatan_id: string | null
  status: 'hadir' | 'sakit' | 'izin' | 'alpa'
  keterangan: string | null
  dicatat_oleh: string
  version: number
  created_at: string
  updated_at: string
}

export interface CatatanHaid {
  id: string
  santri_id: string
  tanggal: string
  status: 'suci' | 'haid'
  catatan: string | null
  dicatat_oleh: string
  created_at: string
  updated_at: string
}

export interface Kelas {
  id: string
  nama: string
  tingkatan: string | null
  tahun_ajaran: string | null
  is_active: number
  created_at: string
  updated_at: string
}

export interface CatatanDisiplin {
  id: string
  santri_id: string
  tipe: 'pelanggaran' | 'prestasi'
  kategori_id: string | null
  judul: string
  deskripsi: string | null
  tanggal_kejadian: string
  dicatat_oleh: string
  tindak_lanjut: string | null
  jenis_prestasi: string | null
  version: number
  is_deleted: number
  created_at: string
  updated_at: string
}

export interface ApiError {
  error: string
  code: string
  message: string
  requestId?: string
  errors?: Array<{
    field: string
    message: string
  }>
  retryAfter?: number
}
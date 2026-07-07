-- ============================================
-- Migration: 002_kamar_kegiatan_absensi_haid
-- Created: 2026-07-07
-- Description: Kamar (dorm) assignment, kegiatan (activities),
--              absensi (daily/activity attendance), catatan haid
-- ============================================

-- Kamar / Dorm rooms
CREATE TABLE IF NOT EXISTS kamar (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L', 'P')),
    kapasitas INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Santri room assignment (1 santri = 1 kamar, like kelas_id)
ALTER TABLE santri ADD COLUMN kamar_id TEXT;

-- Many-to-many: ustadz/ustadzah <-> kamar (wali kamar)
CREATE TABLE IF NOT EXISTS ustadz_kamar (
    user_id TEXT NOT NULL,
    kamar_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kamar_id)
);

-- Kegiatan / named activities (ngaji, ekskul, ujian, dst) beyond plain daily roll call
CREATE TABLE IF NOT EXISTS kegiatan (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    jenis TEXT,
    tanggal TEXT NOT NULL,
    kelas_id TEXT,
    kamar_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Absensi: kegiatan_id NULL = absensi harian umum kelas; diisi = absensi kegiatan tertentu
CREATE TABLE IF NOT EXISTS absensi (
    id TEXT PRIMARY KEY,
    santri_id TEXT NOT NULL,
    tanggal TEXT NOT NULL,
    kegiatan_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('hadir', 'sakit', 'izin', 'alpa')),
    keterangan TEXT,
    dicatat_oleh TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Satu santri hanya boleh punya 1 catatan absensi per (tanggal, kegiatan) —
-- coalesce dipakai karena NULL <> NULL akan lolos dari UNIQUE constraint biasa
CREATE UNIQUE INDEX IF NOT EXISTS idx_absensi_unique
    ON absensi(santri_id, tanggal, COALESCE(kegiatan_id, ''));

-- Catatan suci/haid santri putri — tabel terpisah dari `santri` supaya akses
-- ke data sensitif ini gampang dibatasi (lihat authorization di API layer:
-- admin + wali kamar dari kamar berjenis_kelamin 'P')
CREATE TABLE IF NOT EXISTS catatan_haid (
    id TEXT PRIMARY KEY,
    santri_id TEXT NOT NULL,
    tanggal TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('suci', 'haid')),
    catatan TEXT,
    dicatat_oleh TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catatan_haid_unique ON catatan_haid(santri_id, tanggal);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kamar_jenis_kelamin ON kamar(jenis_kelamin);
CREATE INDEX IF NOT EXISTS idx_santri_kamar ON santri(kamar_id);
CREATE INDEX IF NOT EXISTS idx_ustadz_kamar_user ON ustadz_kamar(user_id);
CREATE INDEX IF NOT EXISTS idx_ustadz_kamar_kamar ON ustadz_kamar(kamar_id);
CREATE INDEX IF NOT EXISTS idx_kegiatan_tanggal ON kegiatan(tanggal);
CREATE INDEX IF NOT EXISTS idx_kegiatan_kelas ON kegiatan(kelas_id);
CREATE INDEX IF NOT EXISTS idx_kegiatan_kamar ON kegiatan(kamar_id);
CREATE INDEX IF NOT EXISTS idx_absensi_santri ON absensi(santri_id);
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON absensi(tanggal);
CREATE INDEX IF NOT EXISTS idx_absensi_kegiatan ON absensi(kegiatan_id);
CREATE INDEX IF NOT EXISTS idx_absensi_updated ON absensi(updated_at);
CREATE INDEX IF NOT EXISTS idx_catatan_haid_santri ON catatan_haid(santri_id);
CREATE INDEX IF NOT EXISTS idx_catatan_haid_tanggal ON catatan_haid(tanggal);

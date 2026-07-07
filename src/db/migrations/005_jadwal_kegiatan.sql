-- ============================================
-- Migration: 005_jadwal_kegiatan
-- Created: 2026-07-07
-- Description: Recurring daily activity templates (sholat berjamaah,
--              ta'lim, dst) so admin/wali kamar don't have to recreate
--              `kegiatan` by hand every single day.
-- ============================================

-- Template kegiatan rutin — tanpa tanggal. `kegiatan` (dated instance) untuk
-- setiap hari otomatis dibuat dari template aktif saat pertama kali diminta
-- (lihat GET /api/kegiatan), ditautkan lewat jadwal_kegiatan_id.
CREATE TABLE IF NOT EXISTS jadwal_kegiatan (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    jenis TEXT,
    urutan INTEGER NOT NULL DEFAULT 0,
    kelas_id TEXT,
    kamar_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE kegiatan ADD COLUMN jadwal_kegiatan_id TEXT;

-- Satu template cuma boleh materialisasi 1 instance kegiatan per tanggal
CREATE UNIQUE INDEX IF NOT EXISTS idx_kegiatan_jadwal_tanggal
    ON kegiatan(jadwal_kegiatan_id, tanggal)
    WHERE jadwal_kegiatan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jadwal_kegiatan_active ON jadwal_kegiatan(is_active);
CREATE INDEX IF NOT EXISTS idx_jadwal_kegiatan_kelas ON jadwal_kegiatan(kelas_id);
CREATE INDEX IF NOT EXISTS idx_jadwal_kegiatan_kamar ON jadwal_kegiatan(kamar_id);

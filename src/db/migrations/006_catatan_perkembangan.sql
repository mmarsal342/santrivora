-- ============================================
-- Migration: 006_catatan_perkembangan
-- Created: 2026-07-08
-- Description: Catatan perkembangan & kejadian khusus santri
--              (di luar pelanggaran/prestasi). Tabel terpisah agar
--              rekap disiplin tetap bersih.
-- ============================================

CREATE TABLE IF NOT EXISTS catatan_perkembangan (
    id TEXT PRIMARY KEY,
    santri_id TEXT NOT NULL,
    tanggal TEXT NOT NULL,
    kategori TEXT NOT NULL CHECK (kategori IN (
        'Perkembangan',
        'Kesehatan',
        'Keluarga',
        'Sosial',
        'Akademik',
        'Spiritual'
    )),
    judul TEXT NOT NULL,
    catatan TEXT,
    dicatat_oleh TEXT NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catatan_perkembangan_santri ON catatan_perkembangan(santri_id);
CREATE INDEX IF NOT EXISTS idx_catatan_perkembangan_tanggal ON catatan_perkembangan(tanggal);
CREATE INDEX IF NOT EXISTS idx_catatan_perkembangan_kategori ON catatan_perkembangan(kategori);

-- ============================================
-- Migration: 010_catatan_personel
-- Created: 2026-07-27
-- Description: Catatan personel (ustadz/ustadzah/kyai/kepala_asrama/admin)
--              -- mirip catatan_perkembangan tapi untuk personel, bukan
--              santri. Ditulis oleh admin & kyai untuk evaluasi kerja,
--              pendapat/keputusan kyai, dsb.
-- ============================================

CREATE TABLE IF NOT EXISTS catatan_personel (
    id TEXT PRIMARY KEY,
    personel_id TEXT NOT NULL REFERENCES users(id),
    tanggal TEXT NOT NULL,
    kategori TEXT NOT NULL CHECK (kategori IN (
        'Kinerja',
        'Kehadiran',
        'Pelanggaran',
        'Prestasi',
        'Keputusan Kyai',
        'Lainnya'
    )),
    judul TEXT NOT NULL,
    catatan TEXT,
    dicatat_oleh TEXT NOT NULL REFERENCES users(id),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catatan_personel_personel ON catatan_personel(personel_id);
CREATE INDEX IF NOT EXISTS idx_catatan_personel_tanggal ON catatan_personel(tanggal);
CREATE INDEX IF NOT EXISTS idx_catatan_personel_kategori ON catatan_personel(kategori);
CREATE INDEX IF NOT EXISTS idx_catatan_personel_deleted ON catatan_personel(is_deleted);

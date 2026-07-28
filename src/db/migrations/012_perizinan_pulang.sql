-- ============================================
-- Migration: 012_perizinan_pulang
-- Created: 2026-07-28
-- Description: Perizinan pulang santri (izin keluar asrama/pulang kampung)
--              dengan alur approval berjenjang: diajukan -> disetujui/ditolak
--              -> selesai (setelah santri kembali).
-- ============================================

CREATE TABLE IF NOT EXISTS perizinan_pulang (
    id TEXT PRIMARY KEY,
    santri_id TEXT NOT NULL REFERENCES santri(id),
    tanggal_keluar TEXT NOT NULL,
    perkiraan_kembali TEXT,
    tanggal_kembali_aktual TEXT,
    alasan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'diajukan'
        CHECK (status IN ('diajukan', 'disetujui', 'ditolak', 'selesai')),
    diajukan_oleh TEXT NOT NULL REFERENCES users(id),
    disetujui_oleh TEXT REFERENCES users(id),
    catatan_keputusan TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_perizinan_santri ON perizinan_pulang(santri_id);
CREATE INDEX IF NOT EXISTS idx_perizinan_status ON perizinan_pulang(status);
CREATE INDEX IF NOT EXISTS idx_perizinan_tanggal ON perizinan_pulang(tanggal_keluar);

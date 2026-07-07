-- ============================================
-- Migration: 003_jenis_prestasi
-- Created: 2026-07-07
-- Description: Free-text "jenis" tag for prestasi entries (not a fixed
--              admin-curated category list like kategori_pelanggaran —
--              ustadz writes whatever they consider an achievement)
-- ============================================

ALTER TABLE catatan_disiplin ADD COLUMN jenis_prestasi TEXT;

CREATE INDEX IF NOT EXISTS idx_catatan_jenis_prestasi ON catatan_disiplin(jenis_prestasi);

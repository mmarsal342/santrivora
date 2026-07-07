-- ============================================
-- Migration: 004_santri_profil
-- Created: 2026-07-07
-- Description: Small optional profile fields for santri — not mandatory,
--              admin/ustadz fill in whatever's known
-- ============================================

ALTER TABLE santri ADD COLUMN tanggal_lahir TEXT;

-- Bebas ketik, bukan dropdown tetap — bantu wali kamar kenal santrinya
-- lebih personal, nggak dibatasi ke 5 kategori baku
ALTER TABLE santri ADD COLUMN love_language TEXT;

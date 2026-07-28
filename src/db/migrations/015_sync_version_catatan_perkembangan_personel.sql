-- ============================================
-- Migration: 015_sync_version_catatan_perkembangan_personel
-- Created: 2026-07-28
-- Description: Fase 3 offline-first — tambah kolom `version` ke
-- catatan_perkembangan dan catatan_personel (keduanya sudah punya updated_at
-- + is_deleted, cuma version yang belum ada). ALTER TABLE ADD COLUMN polos.
-- ============================================

ALTER TABLE catatan_perkembangan ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE catatan_personel ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

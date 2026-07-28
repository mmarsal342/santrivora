-- ============================================
-- Migration: 016_perizinan_pulang_sync_columns
-- Created: 2026-07-28
-- Description: Fase 6 offline-first — perizinan_pulang belum punya kolom
-- version sama sekali dan DELETE-nya masih hard-delete (DELETE FROM). Nambah
-- version (optimistic concurrency) + is_deleted (tombstone, dibutuhkan sync
-- pull supaya pembatalan izin ke-propagate ke client offline). ALTER TABLE
-- ADD COLUMN polos, bukan rebuild tabel.
--
-- Perubahan kode yang menyertai (bukan bagian file SQL ini, tapi wajib
-- bareng): perizinan.ts DELETE /:id ganti dari hard delete jadi soft-delete
-- (is_deleted=1), dan GET / nambah filter is_deleted = 0.
-- ============================================

ALTER TABLE perizinan_pulang ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE perizinan_pulang ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

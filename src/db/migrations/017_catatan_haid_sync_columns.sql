-- ============================================
-- Migration: 017_catatan_haid_sync_columns
-- Created: 2026-07-28
-- Description: Fase 4 offline-first — catatan_haid belum punya kolom version
-- sama sekali dan pakai hard-delete (DELETE FROM). Nambah version (optimistic
-- concurrency) + is_deleted (tombstone, dibutuhkan sync pull supaya
-- penghapusan ke-propagate ke client offline yang sudah nge-cache row itu —
-- hard delete cuma bikin row lenyap tanpa sinyal apa pun). ALTER TABLE ADD
-- COLUMN polos, bukan rebuild tabel.
--
-- Perubahan kode yang menyertai (bukan bagian file SQL ini, tapi wajib
-- bareng): catatanHaid.ts DELETE /:id ganti dari hard delete jadi soft-delete
-- (is_deleted=1), dan GET / nambah filter is_deleted = 0.
-- ============================================

ALTER TABLE catatan_haid ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE catatan_haid ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

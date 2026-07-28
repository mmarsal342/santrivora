-- ============================================
-- Migration: 018_sync_version_kategori_pelanggaran
-- Created: 2026-07-28
-- Description: Fase 22 offline-first (gelombang 1 frontend) — kategori_
-- pelanggaran belum pernah masuk sync engine sama sekali (kelewat di
-- rollout awal, seharusnya dipasangkan bareng kelas/kamar di migrasi 014).
-- Tambah kolom `version` (optimistic concurrency) biar bisa didaftarkan
-- sebagai entity pull-only. ALTER TABLE ADD COLUMN polos — bukan rebuild
-- tabel, jadi tidak butuh pola PRAGMA foreign_keys OFF/ON + BEGIN/COMMIT.
-- ============================================

ALTER TABLE kategori_pelanggaran ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

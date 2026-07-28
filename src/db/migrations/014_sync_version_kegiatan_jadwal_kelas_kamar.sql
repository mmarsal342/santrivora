-- ============================================
-- Migration: 014_sync_version_kegiatan_jadwal_kelas_kamar
-- Created: 2026-07-28
-- Description: Fase 2 offline-first — tambah kolom `version` (optimistic
-- concurrency, dipakai sync engine generik) ke kegiatan, jadwal_kegiatan,
-- kelas, kamar. Keempatnya sudah punya updated_at/is_active, cuma version
-- yang belum ada. ALTER TABLE ADD COLUMN polos — bukan rebuild tabel, jadi
-- tidak butuh pola PRAGMA foreign_keys OFF/ON + BEGIN/COMMIT (itu cuma perlu
-- kalau constraint tabelnya berubah, bukan sekadar nambah kolom).
-- ============================================

ALTER TABLE kegiatan ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jadwal_kegiatan ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE kelas ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE kamar ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

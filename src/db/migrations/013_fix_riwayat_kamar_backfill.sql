-- ============================================
-- Migration: 013_fix_riwayat_kamar_backfill
-- Created: 2026-07-28
-- Description: Koreksi data dari backfill migrasi 011 (riwayat_kamar).
--
-- Migrasi 011 membackfill span TERBUKA (selesai_at NULL) untuk SEMUA
-- santri yang punya kamar_id, tanpa memandang status. Santri yang
-- kamar_id-nya masih terisi tapi statusnya SUDAH bukan 'aktif' (di-
-- "hapus"/lulus SEBELUM migrasi 011 dijalankan) ikut salah ditandai
-- "masih diasuh selamanya" — padahal santri.ts DELETE sengaja tidak
-- mengosongkan kamar_id (biar histori kamar-nya tetap ada), jadi
-- kondisi kamar_id IS NOT NULL saja tidak cukup buat nentuin "masih
-- aktif diasuh".
--
-- Migrasi 011 SENDIRI tidak diubah retroaktif (sudah applied sukses di
-- semua environment) — perbaikannya lewat migrasi baru ini, yang
-- menutup ulang span yang salah berdasarkan status santri SAAT INI.
-- Data santri itu sendiri (nama, riwayat, dst.) sama sekali tidak
-- disentuh — cuma span riwayat_kamar_santri yang ditutup.
-- ============================================

UPDATE riwayat_kamar_santri
SET selesai_at = datetime('now')
WHERE selesai_at IS NULL
  AND santri_id IN (SELECT id FROM santri WHERE status != 'aktif');

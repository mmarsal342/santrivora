-- ============================================
-- Migration: 011_riwayat_kamar
-- Created: 2026-07-28
-- Description: Riwayat penempatan kamar untuk santri & personel (wali kamar).
--              Dipakai untuk menjawab "santri mana saja yang pernah diasuh
--              seorang ustadz/ustadzah" di profil personel — sebelum ini
--              sistem cuma nyimpen assignment kamar yang aktif SEKARANG
--              (santri.kamar_id, ustadz_kamar), ditimpa tiap kali berubah,
--              tanpa jejak historis.
--
-- Catatan keterbatasan: tracking baru mulai dari migrasi ini dijalankan.
-- Assignment yang SUDAH aktif saat migrasi ini jalan di-backfill sebagai
-- "mulai sekarang" (selesai_at NULL) — tanggal mulai yang sebenarnya di
-- masa lalu tidak diketahui/tidak pernah tercatat sebelum ini.
-- ============================================

CREATE TABLE IF NOT EXISTS riwayat_kamar_santri (
    id TEXT PRIMARY KEY,
    santri_id TEXT NOT NULL REFERENCES santri(id),
    kamar_id TEXT NOT NULL REFERENCES kamar(id),
    mulai_at TEXT NOT NULL DEFAULT (datetime('now')),
    selesai_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_riwayat_kamar_santri_santri ON riwayat_kamar_santri(santri_id);
CREATE INDEX IF NOT EXISTS idx_riwayat_kamar_santri_kamar ON riwayat_kamar_santri(kamar_id);
CREATE INDEX IF NOT EXISTS idx_riwayat_kamar_santri_open ON riwayat_kamar_santri(santri_id, selesai_at);

CREATE TABLE IF NOT EXISTS riwayat_kamar_personel (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kamar_id TEXT NOT NULL REFERENCES kamar(id),
    mulai_at TEXT NOT NULL DEFAULT (datetime('now')),
    selesai_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_riwayat_kamar_personel_user ON riwayat_kamar_personel(user_id);
CREATE INDEX IF NOT EXISTS idx_riwayat_kamar_personel_kamar ON riwayat_kamar_personel(kamar_id);
CREATE INDEX IF NOT EXISTS idx_riwayat_kamar_personel_open ON riwayat_kamar_personel(user_id, selesai_at);

-- Backfill assignment yang aktif saat ini sebagai span terbuka ("masih berlaku").
INSERT INTO riwayat_kamar_santri (id, santri_id, kamar_id, mulai_at, selesai_at)
SELECT lower(hex(randomblob(16))), id, kamar_id, datetime('now'), NULL
FROM santri WHERE kamar_id IS NOT NULL;

INSERT INTO riwayat_kamar_personel (id, user_id, kamar_id, mulai_at, selesai_at)
SELECT lower(hex(randomblob(16))), user_id, kamar_id, datetime('now'), NULL
FROM ustadz_kamar;

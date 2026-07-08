-- ============================================
-- Migration: 007_kyai_kepala_asrama_pesan
-- Created: 2026-07-08
-- Description: Tambah peran kyai & kepala_asrama, kolom asrama_jenis,
--              serta tabel pesan (Kyai → ustadz) + pesan_dibaca.
-- ============================================

-- 1. Rebuild users table: perluas CHECK role + tambah kolom asrama_jenis.
--    SQLite tidak bisa ALTER constraint, jadi rebuild tabel (FK referensi
--    dari tabel lain di-resolve by-name, jadi aman).
CREATE TABLE IF NOT EXISTS users_new (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nama_lengkap TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'ustadz', 'kyai', 'kepala_asrama')),
    asrama_jenis TEXT CHECK (asrama_jenis IS NULL OR asrama_jenis IN ('L', 'P')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'suspended')),
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, email, password_hash, nama_lengkap, role, asrama_jenis, status, failed_login_attempts, last_login, created_at, updated_at)
SELECT id, email, password_hash, nama_lengkap, role, NULL, status, failed_login_attempts, last_login, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. Pesan: Kyai mengirim pesan ke ustadz (broadcast / per-asrama / spesifik)
CREATE TABLE IF NOT EXISTS pesan (
    id TEXT PRIMARY KEY,
    pengirim_id TEXT NOT NULL REFERENCES users(id),
    penerima_id TEXT REFERENCES users(id),   -- NULL = broadcast (ke semua / per asrama)
    asrama_jenis TEXT,                        -- bila broadcast: batasi ke asrama ini; NULL = semua
    judul TEXT NOT NULL,
    isi TEXT NOT NULL,
    prioritas TEXT NOT NULL DEFAULT 'biasa' CHECK (prioritas IN ('biasa', 'penting')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pesan_pengirim ON pesan(pengirim_id);
CREATE INDEX IF NOT EXISTS idx_pesan_penerima ON pesan(penerima_id);
CREATE INDEX IF NOT EXISTS idx_pesan_created ON pesan(created_at);

-- 3. Pesan dibaca: tracking baca per penerima
CREATE TABLE IF NOT EXISTS pesan_dibaca (
    pesan_id TEXT NOT NULL REFERENCES pesan(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    dibaca_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (pesan_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pesan_dibaca_user ON pesan_dibaca(user_id);

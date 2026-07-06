-- ============================================
-- Migration: 001_initial_schema
-- Created: 2026-07-06
-- Description: Initial database schema for SantriVora
-- ============================================

-- Users & Auth
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nama_lengkap TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'ustadz')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'suspended')),
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User sessions for token management
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    refresh_token_jti TEXT UNIQUE NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    user_agent TEXT,
    last_activity TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    is_revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Token blacklist for immediate token invalidation
CREATE TABLE IF NOT EXISTS token_blacklist (
    jti TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kelas / Classes
CREATE TABLE IF NOT EXISTS kelas (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    tingkatan TEXT,
    tahun_ajaran TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: ustadz ↔ kelas
CREATE TABLE IF NOT EXISTS ustadz_kelas (
    user_id TEXT NOT NULL,
    kelas_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kelas_id)
);

-- Santri / Students
CREATE TABLE IF NOT EXISTS santri (
    id TEXT PRIMARY KEY,
    nama_lengkap TEXT NOT NULL,
    jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L', 'P')),
    kelas_id TEXT,
    angkatan TEXT,
    tanggal_masuk TEXT,
    status TEXT NOT NULL DEFAULT 'aktif'
        CHECK (status IN ('aktif', 'lulus', 'keluar')),
    foto_url TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kategori pelanggaran / Violation categories
CREATE TABLE IF NOT EXISTS kategori_pelanggaran (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    deskripsi TEXT,
    urutan_keparahan INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catatan disiplin / Discipline records
CREATE TABLE IF NOT EXISTS catatan_disiplin (
    id TEXT PRIMARY KEY,
    santri_id TEXT NOT NULL,
    tipe TEXT NOT NULL CHECK (tipe IN ('pelanggaran', 'prestasi')),
    kategori_id TEXT,
    judul TEXT NOT NULL,
    deskripsi TEXT,
    tanggal_kejadian TEXT NOT NULL,
    dicatat_oleh TEXT NOT NULL,
    tindak_lanjut TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Global settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync conflicts
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    client_version INTEGER NOT NULL,
    server_version INTEGER NOT NULL,
    client_data TEXT NOT NULL,
    server_data TEXT NOT NULL,
    conflict_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'resolved')),
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(refresh_token_jti);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_santri_kelas ON santri(kelas_id);
CREATE INDEX IF NOT EXISTS idx_santri_status ON santri(status);
CREATE INDEX IF NOT EXISTS idx_santri_angkatan ON santri(angkatan);
CREATE INDEX IF NOT EXISTS idx_santri_jenis_kelamin ON santri(jenis_kelamin);
CREATE INDEX IF NOT EXISTS idx_santri_updated ON santri(updated_at);
CREATE INDEX IF NOT EXISTS idx_catatan_santri ON catatan_disiplin(santri_id);
CREATE INDEX IF NOT EXISTS idx_catatan_tipe ON catatan_disiplin(tipe);
CREATE INDEX IF NOT EXISTS idx_catatan_tanggal ON catatan_disiplin(tanggal_kejadian);
CREATE INDEX IF NOT EXISTS idx_catatan_updated ON catatan_disiplin(updated_at);
CREATE INDEX IF NOT EXISTS idx_catatan_deleted ON catatan_disiplin(is_deleted);
CREATE INDEX IF NOT EXISTS idx_ustadz_kelas_user ON ustadz_kelas(user_id);
CREATE INDEX IF NOT EXISTS idx_ustadz_kelas_kelas ON ustadz_kelas(kelas_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);
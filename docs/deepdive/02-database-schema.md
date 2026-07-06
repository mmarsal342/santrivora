# Deepdive: Database Schema & Migrations

**Last Updated:** 2026-07-06
**Status:** Final Draft
**Applies To:** D1 Database

---

## Table of Contents

1. [Database Philosophy](#1-database-philosophy)
2. [Final Schema Definition](#2-final-schema-definition)
3. [Indexing Strategy](#3-indexing-strategy)
4. [Query Patterns & Optimization](#4-query-patterns--optimization)
5. [Migration System](#5-migration-system)
6. [Seed Data Strategy](#6-seed-data-strategy)
7. [Data Integrity & Constraints](#7-data-integrity--constraints)
8. [Soft Delete Strategy](#8-soft-delete-strategy)
9. [Performance Considerations](#9-performance-considerations)
10. [Backup & Restore Strategy](#10-backup--restore-strategy)
11. [Migration Checklist](#11-migration-checklist)

---

## 1. Database Philosophy

### Design Principles
1. **Schema-first**: All data models defined before any code
2. **Migration-based**: Schema changes always through migrations
3. **Index-aware**: Every query pattern has matching index
4. **Constraint-validated**: Data integrity enforced at database level
5. **Soft-delete friendly**: Never permanently delete data

### D1 Limitations & Workarounds
| Limitation | Workaround |
|---|---|
| No foreign key enforcement | Application-level validation |
| No full-text search | LIKE query with proper indexing or SQLite FTS5 |
| 100k rows per query | Always paginate |
| No stored procedures | All logic in application layer |
| Max 10MB per SQL statement | Split large migrations |
| No ALTER TABLE ADD CONSTRAINT | Recreate table + migrate data |

---

## 2. Final Schema Definition

### 2.1 Complete DDL

```sql
-- ============================================
-- Migration: 001_initial_schema
-- Created: 2026-07-06
-- ============================================

-- Users & Auth
CREATE TABLE users (
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
CREATE TABLE sessions (
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
CREATE TABLE token_blacklist (
    jti TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kelas / Classes
CREATE TABLE kelas (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    tingkatan TEXT,
    tahun_ajaran TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: ustadz ↔ kelas
CREATE TABLE ustadz_kelas (
    user_id TEXT NOT NULL,
    kelas_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kelas_id)
);

-- Santri / Students
CREATE TABLE santri (
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
CREATE TABLE kategori_pelanggaran (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    deskripsi TEXT,
    urutan_keparahan INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catatan disiplin / Discipline records
CREATE TABLE catatan_disiplin (
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
CREATE TABLE audit_log (
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
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync conflicts
CREATE TABLE sync_conflicts (
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

-- Indexes (optimized for query patterns)
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_jti ON sessions(refresh_token_jti);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_santri_kelas ON santri(kelas_id);
CREATE INDEX idx_santri_status ON santri(status);
CREATE INDEX idx_santri_angkatan ON santri(angkatan);
CREATE INDEX idx_santri_jenis_kelamin ON santri(jenis_kelamin);
CREATE INDEX idx_santri_updated ON santri(updated_at);
CREATE INDEX idx_catatan_santri ON catatan_disiplin(santri_id);
CREATE INDEX idx_catatan_tipe ON catatan_disiplin(tipe);
CREATE INDEX idx_catatan_tanggal ON catatan_disiplin(tanggal_kejadian);
CREATE INDEX idx_catatan_updated ON catatan_disiplin(updated_at);
CREATE INDEX idx_catatan_deleted ON catatan_disiplin(is_deleted);
CREATE INDEX idx_ustadz_kelas_user ON ustadz_kelas(user_id);
CREATE INDEX idx_ustadz_kelas_kelas ON ustadz_kelas(kelas_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
CREATE INDEX idx_sync_conflicts_status ON sync_conflicts(status);
CREATE INDEX idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);
CREATE INDEX idx_token_blacklist_expires ON token_blacklist(expires_at);
```

### 2.2 Entity Relationship Diagram

```
users
  │
  ├── sessions (1:N) — user sessions
  ├── token_blacklist (1:N) — blacklisted tokens
  ├── ustadz_kelas (N:M) — kelas assignments
  ├── audit_log (1:N) — user actions
  ├── catatan_disiplin (1:N) — dicatat_oleh
  └── sync_conflicts (1:N) — resolved_by

kelas
  │
  ├── ustadz_kelas (N:M) — ustadz assignments
  └── santri (1:N) — students in kelas

santri
  │
  ├── catatan_disiplin (1:N) — discipline records
  └── sync_conflicts (1:N) — sync conflicts

kategori_pelanggaran
  │
  └── catatan_disiplin (1:N) — category reference
```

### 2.3 Field Level Details

#### users
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | TEXT | PK, UUID | Generated server-side |
| email | TEXT | UNIQUE, NOT NULL | Case-insensitive, lowercase storage |
| password_hash | TEXT | NOT NULL | bcrypt, cost=12 |
| nama_lengkap | TEXT | NOT NULL | Minimal 2 karakter |
| role | TEXT | CHECK(admin/ustadz) | Set saat register |
| status | TEXT | CHECK(pending/approved/suspended) | Default: pending |
| failed_login_attempts | INTEGER | DEFAULT 0 | Reset after successful login |
| last_login | TEXT | NULLABLE | ISO 8601 datetime |
| created_at | TEXT | NOT NULL | ISO 8601 |
| updated_at | TEXT | NOT NULL | Auto-update by application |

#### santri
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | TEXT | PK, UUID | |
| nama_lengkap | TEXT | NOT NULL | |
| jenis_kelamin | TEXT | CHECK(L/P) | |
| kelas_id | TEXT | FK→kelas.id | Nullable jika belum assign |
| angkatan | TEXT | | Tahun angkatan |
| tanggal_masuk | TEXT | | ISO 8601 date |
| status | TEXT | CHECK(aktif/lulus/keluar) | |
| foto_url | TEXT | | R2 signed URL |
| version | INTEGER | DEFAULT 1 | Incremented for conflict detection |
| created_at | TEXT | NOT NULL | |
| updated_at | TEXT | NOT NULL | |

#### catatan_disiplin
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | TEXT | PK, UUID | |
| santri_id | TEXT | FK, NOT NULL | |
| tipe | TEXT | CHECK(pelanggaran/prestasi) | |
| kategori_id | TEXT | FK→kategori_pelanggaran.id | Required if tipe=pelanggaran |
| judul | TEXT | NOT NULL | |
| deskripsi | TEXT | | Long text |
| tanggal_kejadian | TEXT | NOT NULL | ISO 8601 date |
| dicatat_oleh | TEXT | FK, NOT NULL | User ID |
| tindak_lanjut | TEXT | | Follow-up notes |
| version | INTEGER | DEFAULT 1 | |
| is_deleted | INTEGER | DEFAULT 0 | Soft delete |
| created_at | TEXT | NOT NULL | |
| updated_at | TEXT | NOT NULL | |

---

## 3. Indexing Strategy

### 3.1 Index Justification

| Index | Query Pattern | Explanation |
|---|---|---|
| idx_users_email | `WHERE email = ?` | Login lookup |
| idx_users_status | `WHERE status = 'pending'` | Admin pending list |
| idx_sessions_user | `WHERE user_id = ?` | User session queries |
| idx_sessions_jti | `WHERE refresh_token_jti = ?` | Token rotation lookup |
| idx_sessions_expires | `WHERE expires_at < now()` | Cleanup expired sessions |
| idx_santri_kelas | `WHERE kelas_id = ?` | Filter by kelas |
| idx_santri_status | `WHERE status = 'aktif'` | Active students filter |
| idx_santri_angkatan | `WHERE angkatan = ?` | Filter by angkatan |
| idx_santri_jenis_kelamin | `WHERE jenis_kelamin = ?` | Filter by gender |
| idx_santri_updated | `WHERE updated_at > ?` | Sync pull query |
| idx_catatan_santri | `WHERE santri_id = ?` | Student records view |
| idx_catatan_tipe | `WHERE tipe = ?` | Filter by type |
| idx_catatan_tanggal | `WHERE tanggal_kejadian BETWEEN ? AND ?` | Date range queries |
| idx_catatan_updated | `WHERE updated_at > ?` | Sync pull |
| idx_catatan_deleted | `WHERE is_deleted = 0` | Exclude soft-deleted |
| idx_audit_log_entity | `WHERE entity_type=? AND entity_id=?` | Entity history |
| idx_audit_log_user | `WHERE user_id = ?` | User activity |
| idx_audit_log_created | `ORDER BY created_at DESC` | Recent activity |
| idx_sync_conflicts_status | `WHERE status = 'pending'` | Pending conflicts |

### 3.2 Composite Indexes

```sql
-- Compound WHERE clauses need composite indexes
-- Admin dashboard: count violations per kelas
CREATE INDEX idx_catatan_kelas_tipe
    ON catatan_disiplin(santri_id, tipe);

-- Santri list with kelas filter + status
CREATE INDEX idx_santri_kelas_status
    ON santri(kelas_id, status);

-- Audit log: entity type + action
CREATE INDEX idx_audit_log_entity_action
    ON audit_log(entity_type, action);
```

### 3.3 Index Monitoring

```sql
-- Check index usage (SQLite)
SELECT
    name,
    rank
FROM (
    SELECT
        m.name,
        CASE WHEN p IS NULL THEN 'never used' ELSE 'used' END AS rank
    FROM sqlite_master AS m
    LEFT JOIN pragma_index_info(m.name) AS p
    WHERE m.type = 'index'
)
ORDER BY name;
```

---

## 4. Query Patterns & Optimization

### 4.1 Common Queries with Optimization

```sql
-- 1. Login lookup (by email)
-- Index: idx_users_email
SELECT * FROM users WHERE email = ?;

-- 2. Pending users for admin
-- Index: idx_users_status
-- Pagination: cursor-based
SELECT * FROM users
WHERE status = 'pending'
  AND id > ?
ORDER BY id
LIMIT 20;

-- 3. Santri list dengan filter
-- Index: idx_santri_kelas_status, idx_santri_kelas
SELECT s.*, k.nama as kelas_nama
FROM santri s
LEFT JOIN kelas k ON s.kelas_id = k.id
WHERE s.kelas_id = ?
  AND s.status = 'aktif'
  AND s.id > ?
ORDER BY s.id
LIMIT 20;

-- 4. Catatan disiplin for a santri
-- Index: idx_catatan_santri
SELECT cd.*, k.nama as kategori_nama, u.nama_lengkap as dicatat_oleh_nama
FROM catatan_disiplin cd
LEFT JOIN kategori_pelanggaran k ON cd.kategori_id = k.id
LEFT JOIN users u ON cd.dicatat_oleh = u.id
WHERE cd.santri_id = ?
  AND cd.is_deleted = 0
ORDER BY cd.tanggal_kejadian DESC
LIMIT 50;

-- 5. Sync pull (changes since timestamp)
-- Index: idx_santri_updated, idx_catatan_updated
SELECT * FROM santri
WHERE updated_at > ?
  AND id > ?
ORDER BY id
LIMIT 100;

-- 6. Dashboard: violations count per category
SELECT k.id, k.nama, COUNT(*) as total
FROM catatan_disiplin cd
JOIN kategori_pelanggaran k ON cd.kategori_id = k.id
WHERE cd.tipe = 'pelanggaran'
  AND cd.created_at >= datetime('now', '-30 days')
  AND cd.is_deleted = 0
GROUP BY k.id, k.nama
ORDER BY total DESC;

-- 7. Dashboard: trend data
SELECT
    DATE(tanggal_kejadian) as date,
    tipe,
    COUNT(*) as total
FROM catatan_disiplin
WHERE tanggal_kejadian >= datetime('now', '-7 days')
  AND is_deleted = 0
GROUP BY DATE(tanggal_kejadian), tipe
ORDER BY date;
```

### 4.2 Pagination Strategy

**Cursor-based pagination (recommended)** over offset-based:

```typescript
// Cursor-based (better for D1)
async function getSantriList(c: Context) {
    const { kelas_id, status, cursor, limit = 20 } = c.req.query()

    let query = 'SELECT * FROM santri WHERE 1=1'
    const params: unknown[] = []

    if (kelas_id) {
        query += ' AND kelas_id = ?'
        params.push(kelas_id)
    }
    if (status) {
        query += ' AND status = ?'
        params.push(status)
    }
    if (cursor) {
        // Cursor is the last ID from previous page
        query += ' AND id > ?'
        params.push(cursor)
    }

    query += ' ORDER BY id LIMIT ?'
    params.push(limit + 1)  // Fetch one extra to check hasMore

    const results = await c.env.DB.prepare(query).bind(...params).all()
    const hasMore = results.length > limit

    return {
        data: hasMore ? results.slice(0, limit) : results,
        cursor: hasMore ? results[limit - 1].id : null,
        hasMore
    }
}
```

### 4.3 Explain Plan Analysis

```sql
-- Analyze query execution
EXPLAIN QUERY PLAN
SELECT s.*, k.nama as kelas_nama
FROM santri s
LEFT JOIN kelas k ON s.kelas_id = k.id
WHERE s.kelas_id = 'abc'
  AND s.status = 'aktif'
ORDER BY s.id
LIMIT 20;

-- Expected output:
-- |--SCAN santri USING INDEX idx_santri_kelas_status
-- |--SEARCH kelas USING INTEGER PRIMARY KEY (rowid?)
```

---

## 5. Migration System

### 5.1 Migration Structure

```sql
-- migrations/001_initial_schema.sql
-- migrations/002_add_santri_phone.sql
-- migrations/003_add_catatan_index.sql

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    checksum TEXT NOT NULL,
    duration_ms INTEGER NOT NULL
);
```

### 5.2 Migration Runner

```typescript
// db/migrate.ts
import fs from 'fs/promises'
import path from 'path'

async function runMigrations(env: Env) {
    // Ensure migration tracking table exists
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            checksum TEXT NOT NULL,
            duration_ms INTEGER NOT NULL
        )
    `).run()

    // Get applied migrations
    const applied = await env.DB.prepare(
        'SELECT name, checksum FROM _migrations ORDER BY id'
    ).all()
    const appliedMap = new Map(
        applied.map(m => [m.name, m.checksum])
    )

    // Read migration files
    const migrationsDir = path.join(import.meta.dir, 'migrations')
    const files = await fs.readdir(migrationsDir)
    files.sort() // Ensure order

    for (const file of files) {
        if (!file.endsWith('.sql')) continue

        const content = await fs.readFile(
            path.join(migrationsDir, file), 'utf-8'
        )
        const checksum = await hashContent(content)

        if (appliedMap.has(file)) {
            // Verify checksum
            if (appliedMap.get(file) !== checksum) {
                throw new Error(
                    `Migration ${file} has been modified after application!`
                )
            }
            continue // Already applied
        }

        // Apply migration
        const start = Date.now()
        try {
            // Split by semicolons for multiple statements
            const statements = content
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.startsWith('--'))

            for (const stmt of statements) {
                await env.DB.prepare(stmt).run()
            }

            const duration = Date.now() - start

            // Record migration
            await env.DB.prepare(
                `INSERT INTO _migrations (name, checksum, duration_ms)
                 VALUES (?, ?, ?)`
            ).bind(file, checksum, duration).run()

            console.log(`[Migration] Applied: ${file} (${duration}ms)`)
        } catch (err) {
            console.error(`[Migration] Failed: ${file}`, err)
            throw err
        }
    }
}

async function hashContent(content: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(content)
    )
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}
```

### 5.3 Migration Guidelines

**Creating a new migration:**
```bash
# Naming convention: NNN_description.sql
# Example: 002_add_santri_phone.sql
```

**Migration template:**
```sql
-- ============================================
-- Migration: 002_add_santri_phone
-- Description: Add phone number to santri
-- Created: 2026-07-06
-- ============================================

-- UP: Apply changes
ALTER TABLE santri ADD COLUMN no_telepon TEXT;

-- DOWN: Rollback (if needed)
-- WARNING: This will drop data!
-- CREATE TABLE santri_new (
--     id TEXT PRIMARY KEY,
--     ...all old columns except no_telepon...
-- );
-- INSERT INTO santri_new SELECT id, nama_lengkap, ... FROM santri;
-- DROP TABLE santri;
-- ALTER TABLE santri_new RENAME TO santri;
```

### 5.4 Migration Rules

1. **Never modify an existing migration** — always create new one
2. **Test migrations locally first** before deploying
3. **Always make migrations reversible** (have a down strategy)
4. **Add comments** explaining why the change is needed
5. **Keep migrations small and focused** — one change per file
6. **Always add corresponding indexes** when adding filterable columns

---

## 6. Seed Data Strategy

### 6.1 Seed File Structure

```sql
-- seeds/001_admin.sql
-- Create initial admin account
INSERT OR IGNORE INTO users (id, email, password_hash, nama_lengkap, role, status)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'admin@santrivora.com',
    '$2a$12$...',  -- Password: Admin123!
    'Administrator Sistem',
    'admin',
    'approved'
);

-- seeds/002_kelas.sql
INSERT INTO kelas (id, nama, tingkatan, tahun_ajaran)
VALUES
    ('k001', 'Kelas 1A', '1', '2025/2026'),
    ('k002', 'Kelas 1B', '1', '2025/2026'),
    ('k003', 'Kelas 2A', '2', '2025/2026'),
    ('k004', 'Kelas 2B', '2', '2025/2026');

-- seeds/003_kategori.sql
INSERT INTO kategori_pelanggaran (id, nama, deskripsi, urutan_keparahan)
VALUES
    ('kp001', 'Ringan', 'Pelanggaran ringan seperti terlambat', 1),
    ('kp002', 'Sedang', 'Pelanggaran sedang seperti bolos', 2),
    ('kp003', 'Berat', 'Pelanggaran berat seperti berkelahi', 3);

-- seeds/004_settings.sql
INSERT INTO settings (key, value, description)
VALUES
    ('tahun_ajaran_aktif', '2025/2026', 'Tahun ajaran yang sedang berjalan'),
    ('nama_pesantren', 'Pesantren SantriVora', 'Nama pesantren'),
    ('max_santri_per_kelas', '30', 'Batas maksimal santri per kelas');
```

### 6.2 Seed Runner

```typescript
// db/seed.ts
async function runSeeds(env: Env) {
    const seedsDir = path.join(import.meta.dir, 'seeds')

    // Only run in development
    if (env.ENVIRONMENT !== 'development') {
        console.log('[Seed] Skipping seeds in non-dev environment')
        return
    }

    const files = await fs.readdir(seedsDir)
    files.sort()

    for (const file of files) {
        if (!file.endsWith('.sql')) continue

        const content = await fs.readFile(
            path.join(seedsDir, file), 'utf-8'
        )

        try {
            const statements = content
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.startsWith('--'))

            for (const stmt of statements) {
                await env.DB.prepare(stmt).run()
            }

            console.log(`[Seed] Applied: ${file}`)
        } catch (err) {
            console.error(`[Seed] Failed: ${file}`, err)
        }
    }
}
```

---

## 7. Data Integrity & Constraints

### 7.1 Application-Level Validation

Since D1 doesn't enforce foreign keys, we validate in application layer:

```typescript
// Ensure referential integrity
async function validateSantriRefs(env: Env, santriData: SantriInput) {
    if (santriData.kelas_id) {
        const kelas = await env.DB.prepare(
            'SELECT id FROM kelas WHERE id = ? AND is_active = 1'
        ).bind(santriData.kelas_id).first()

        if (!kelas) {
            throw new AppError(404, ErrorCode.KELAS_NOT_FOUND,
                'Kelas tidak ditemukan atau tidak aktif')
        }
    }
}

async function validateCatatanRefs(env: Env, catatanData: CatatanInput) {
    const santri = await env.DB.prepare(
        'SELECT id, status FROM santri WHERE id = ?'
    ).bind(catatanData.santri_id).first()

    if (!santri) {
        throw new AppError(404, ErrorCode.SANTRI_NOT_FOUND,
            'Santri tidak ditemukan')
    }

    if (santri.status !== 'aktif') {
        throw new AppError(400, ErrorCode.SANTRI_NOT_ACTIVE,
            'Santri tidak dalam status aktif')
    }

    if (catatanData.tipe === 'pelanggaran' && catatanData.kategori_id) {
        const kategori = await env.DB.prepare(
            'SELECT id FROM kategori_pelanggaran WHERE id = ? AND is_active = 1'
        ).bind(catatanData.kategori_id).first()

        if (!kategori) {
            throw new AppError(404, ErrorCode.KATEGORI_NOT_FOUND,
                'Kategori pelanggaran tidak ditemukan')
        }
    }
}
```

### 7.2 Unique Constraints

```typescript
// Handle unique constraint violations gracefully
async function createUser(env: Env, userData: UserInput) {
    try {
        const result = await env.DB.prepare(
            `INSERT INTO users (id, email, password_hash, nama_lengkap, role)
             VALUES (?, ?, ?, ?, ?)`
        ).bind(
            crypto.randomUUID(),
            userData.email.toLowerCase(), // Normalize email
            userData.password_hash,
            userData.nama_lengkap,
            userData.role
        ).run()

        return result
    } catch (err) {
        if (err.message?.includes('UNIQUE constraint failed: users.email')) {
            throw new AppError(409, ErrorCode.DUPLICATE_EMAIL,
                'Email sudah terdaftar')
        }
        throw err
    }
}
```

---

## 8. Soft Delete Strategy

### 8.1 Implementation Pattern

All deletable entities use soft delete pattern:

```typescript
// Soft delete function
async function softDelete(env: Env, table: string, id: string) {
    const result = await env.DB.prepare(
        `UPDATE ${table} SET is_deleted = 1, updated_at = datetime('now')
         WHERE id = ? AND is_deleted = 0`
    ).bind(id).run()

    if (result.changes === 0) {
        throw new AppError(404, 'NOT_FOUND',
            'Data tidak ditemukan atau sudah dihapus')
    }

    return { deleted: true }
}

// All queries must exclude soft-deleted records
const ACTIVE_RECORD = 'AND is_deleted = 0'

// Restore soft-deleted record
async function restore(env: Env, table: string, id: string) {
    const result = await env.DB.prepare(
        `UPDATE ${table} SET is_deleted = 0, updated_at = datetime('now')
         WHERE id = ? AND is_deleted = 1`
    ).bind(id).run()

    if (result.changes === 0) {
        throw new AppError(404, 'NOT_FOUND',
            'Data tidak ditemukan atau sudah aktif')
    }

    return { restored: true }
}
```

### 8.2 Data Cleanup Strategy

```sql
-- Archive or permanently delete old soft-deleted records
-- Run periodically (cron trigger)

-- Delete soft-deleted records older than 90 days
DELETE FROM catatan_disiplin
WHERE is_deleted = 1
  AND updated_at < datetime('now', '-90 days');
```

---

## 9. Performance Considerations

### 9.1 D1 Limits Monitoring

```typescript
// Track query performance
interface QueryMetrics {
    query: string
    duration: number
    rows: number
    timestamp: string
    endpoint: string
}

// Log slow queries (>100ms) for optimization
const SLOW_QUERY_THRESHOLD = 100

async function trackQuery(metrics: QueryMetrics) {
    if (metrics.duration > SLOW_QUERY_THRESHOLD) {
        console.warn('[Slow Query]', {
            duration: `${metrics.duration}ms`,
            rows: metrics.rows,
            endpoint: metrics.endpoint,
            query: metrics.query.substring(0, 200)
        })
    }
}
```

### 9.2 Query Optimization Rules

1. **Always use indexes** — every WHERE/ORDER BY needs index
2. **Limit results** — never query without LIMIT
3. **Avoid SELECT *** — specify columns needed
4. **Use batch operations** — minimize round trips
5. **Prepare statements** — reuse prepared statements
6. **Avoid SELECT DISTINCT on large tables**
7. **Use COUNT(_) instead of COUNT(id)** — faster

### 9.3 Connection Management

```typescript
// D1 handles connection pooling automatically
// But batch operations for efficiency

// Batch insert example
async function batchCreateSantri(env: Env, santris: SantriInput[]) {
    const batch = santris.map(s => ({
        id: crypto.randomUUID(),
        ...s,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }))

    // Use batch for D1
    const stmt = env.DB.prepare(
        `INSERT INTO santri (id, nama_lengkap, jenis_kelamin, kelas_id,
         angkatan, tanggal_masuk, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'aktif', 1, ?, ?)`
    )

    const results = await env.DB.batch(
        batch.map(s => stmt.bind(
            s.id, s.nama_lengkap, s.jenis_kelamin, s.kelas_id,
            s.angkatan, s.tanggal_masuk, s.created_at, s.updated_at
        ))
    )

    return batch.map((s, i) => ({
        local_id: s.id,
        success: results[i].success,
        error: results[i].error
    }))
}
```

---

## 10. Backup & Restore Strategy

### 10.1 Automated Backup

```sql
-- D1 backup via wrangler CLI
-- # Manual backup
-- wrangler d1 backup create santrivora-db --remote
-- 
-- # List backups
-- wrangler d1 backup list santrivora-db --remote
--
-- # Restore backup
-- wrangler d1 backup restore santrivora-db <backup-id> --remote
```

### 10.2 Scheduled Backups

```typescript
// Cloudflare Cron Trigger (in wrangler.toml)
// [triggers]
// crons = ["0 0 * * *"]  // Daily at midnight

export default {
    async scheduled(event, env, ctx) {
        // Check if this is the production environment
        if (env.ENVIRONMENT !== 'production') return

        // Create backup
        const backupName = `daily-${new Date().toISOString().split('T')[0]}`

        // Log backup attempt
        await env.DB.prepare(
            `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
             VALUES (?, 'system', 'backup.create', 'system', 'database')`
        ).bind(crypto.randomUUID()).run()

        // Note: D1 doesn't have programmatic backup API yet
        // Use wrangler CLI in CI/CD pipeline instead
    }
}
```

### 10.3 Disaster Recovery Plan

1. **Backup frequency**: Every 24 hours
2. **Retention**: 30 daily backups
3. **Recovery time objective**: 4 hours
4. **Recovery point objective**: 24 hours
5. **Recovery steps**:
   - Deploy a new D1 instance
   - Restore from latest backup
   - Verify data integrity
   - Update Worker bindings
   - Verify application functionality

---

## 11. Migration Checklist

### Before Creating Migration
- [ ] What is the business requirement?
- [ ] Which tables need to change?
- [ ] Is it possible without breaking existing data?
- [ ] Do we need new indexes?
- [ ] Is the migration reversible?

### Migration File Template
```sql
-- ============================================
-- Migration: NNN_short_description
-- Description: One-liner explaining the change
-- Created: YYYY-MM-DD
-- ============================================

-- UP:
ALTER TABLE table_name ADD COLUMN new_column TEXT;

-- DOWN (rollback):
-- ALTER TABLE table_name DROP COLUMN new_column;
```

### Before Deployment
- [ ] Run all migrations locally
- [ ] Verify data integrity
- [ ] Run existing test suite
- [ ] Test rollback procedure
- [ ] Back up production database

### Post-Deployment
- [ ] Verify migration was applied
- [ ] Monitor query performance
- [ ] Check error logs for constraint violations
- [ ] Verify indexes are being used

---

**Related Documents:**
- [01-security-auth.md](./01-security-auth.md)
- [03-sync-conflict-resolution.md](./03-sync-conflict-resolution.md)
- [05-error-handling-logging.md](./05-error-handling-logging.md)

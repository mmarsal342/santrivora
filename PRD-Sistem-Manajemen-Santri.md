# PRD & Arsitektur Teknis: Sistem Manajemen Santri

**Status:** Draft v2 — improved dengan security, sync robustness, dan production readiness
**Stack:** Full Cloudflare (Workers + D1 + R2)
**Frontend:** Vue 3 + Vite + Pinia + Tailwind CSS
**Last Updated:** 2026-07-06

-----

## 1. Overview & Tujuan

Sistem digital untuk mengelola data santri di pesantren: profil lengkap, pengelompokan (kelas/tingkatan/jenis kelamin), serta pencatatan kedisiplinan (pelanggaran & prestasi). Didesain **offline-first** — bisa dipakai tanpa internet di lapangan, lalu sinkron otomatis begitu koneksi tersedia.

-----

## 2. User Roles & Akses

|Role      |Lihat Santri             |Input Catatan Disiplin   |Kelola Kategori Pelanggaran|Approve/Kelola Akun Ustadz|
|----------|-------------------------|-------------------------|---------------------------|--------------------------|
|**Admin** |Semua santri             |Semua kelas              |✅                          |✅                         |
|**Ustadz**|Hanya kelas yang dipegang|Hanya kelas yang dipegang|❌                          |❌                         |

### Auth Flow

1. Ustadz melakukan **self-register** (email + password) → status akun: `pending`.
1. Admin melihat daftar akun `pending` di dashboard admin → **approve** dan **assign kelas** yang dipegang (bisa lebih dari satu kelas).
1. Setelah status `approved` dan minimal 1 kelas ter-assign, akun bisa login dan mengakses data sesuai scope kelasnya.
1. Admin bisa menonaktifkan (`suspended`) akun ustadz kapan saja.

-----

## 3. Data Model (Entitas Utama)

- **santri** — nama lengkap, jenis kelamin, kelas_id, tingkatan, angkatan, tanggal masuk, status (aktif/lulus/keluar), foto (opsional, R2), **version** (untuk conflict resolution)
- **kelas** — nama kelas, tingkatan, tahun ajaran, **is_active** (soft delete)
- **kategori_pelanggaran** — dikelola bebas oleh admin: nama level (misal: Ringan/Sedang/Berat, atau custom lain), deskripsi, urutan keparahan, **is_active**
- **catatan_disiplin** — santri_id, tipe (`pelanggaran`/`prestasi`), kategori_id (khusus pelanggaran), judul, deskripsi, tanggal kejadian, dicatat_oleh (user_id), tindak_lanjut (opsional), **version**, **updated_at**
- **users** — email, password_hash, role (`admin`/`ustadz`), status (`pending`/`approved`/`suspended`), **nama_lengkap**, **last_login**, **updated_at**
- **ustadz_kelas** — tabel relasi many-to-many: user_id ↔ kelas_id (kelas yang dipegang seorang ustadz)
- **audit_log** — tracking semua operasi kritikal: user_id, action, entity_type, entity_id, old_value, new_value, timestamp
- **settings** — konfigurasi global: tahun_ajaran_aktif, nama_pesantren, dll
- **sync_conflicts** — menyimpan conflict yang belum resolved untuk manual merge

-----

## 4. Schema D1 (SQL)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nama_lengkap TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'ustadz')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kelas (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  tingkatan TEXT,
  tahun_ajaran TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ustadz_kelas (
  user_id TEXT NOT NULL REFERENCES users(id),
  kelas_id TEXT NOT NULL REFERENCES kelas(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kelas_id)
);

CREATE TABLE santri (
  id TEXT PRIMARY KEY,
  nama_lengkap TEXT NOT NULL,
  jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L','P')),
  kelas_id TEXT REFERENCES kelas(id),
  angkatan TEXT,
  tanggal_masuk TEXT,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','lulus','keluar')),
  foto_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kategori_pelanggaran (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  deskripsi TEXT,
  urutan_keparahan INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE catatan_disiplin (
  id TEXT PRIMARY KEY,
  santri_id TEXT NOT NULL REFERENCES santri(id),
  tipe TEXT NOT NULL CHECK (tipe IN ('pelanggaran','prestasi')),
  kategori_id TEXT REFERENCES kategori_pelanggaran(id),
  judul TEXT NOT NULL,
  deskripsi TEXT,
  tanggal_kejadian TEXT NOT NULL,
  dicatat_oleh TEXT NOT NULL REFERENCES users(id),
  tindak_lanjut TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  client_version INTEGER NOT NULL,
  server_version INTEGER NOT NULL,
  client_data TEXT NOT NULL,
  server_data TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_santri_kelas ON santri(kelas_id);
CREATE INDEX idx_santri_status ON santri(status);
CREATE INDEX idx_catatan_santri ON catatan_disiplin(santri_id);
CREATE INDEX idx_catatan_tanggal ON catatan_disiplin(tanggal_kejadian);
CREATE INDEX idx_catatan_deleted ON catatan_disiplin(is_deleted);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);
CREATE INDEX idx_sync_conflicts_status ON sync_conflicts(status);
```

-----

## 5. API Endpoints (Cloudflare Workers)

**Auth**

- `POST /api/auth/register` — self-register ustadz (status → pending)
- `POST /api/auth/login` — login, return JWT (access: 15min, refresh: 7d)
- `POST /api/auth/refresh` — refresh access token
- `POST /api/auth/logout` — invalidate refresh token
- `GET /api/auth/me` — info user + kelas yang dipegang

**Admin — User Management**

- `GET /api/admin/users?status=pending&page=1&limit=20` — list akun pending (paginated)
- `GET /api/admin/users/:id` — detail user + audit history
- `POST /api/admin/users/:id/approve` — approve + assign kelas
- `POST /api/admin/users/:id/suspend`
- `POST /api/admin/users/:id/activate`
- `GET /api/admin/audit-log?entity_type=&entity_id=&user_id=` — audit log filtering

**Kelas**

- `GET /api/kelas?page=1&limit=20&is_active=1` — list kelas (admin: semua, ustadz: yang dipegang)
- `GET /api/kelas/:id` — detail kelas + jumlah santri
- `POST /api/kelas` / `PUT /api/kelas/:id` — admin only
- `DELETE /api/kelas/:id` — soft delete, admin only

**Kategori Pelanggaran**

- `GET /api/kategori-pelanggaran?is_active=1`
- `GET /api/kategori-pelanggaran/:id`
- `POST /api/kategori-pelanggaran` / `PUT /api/kategori-pelanggaran/:id` / `DELETE` — admin only

**Santri**

- `GET /api/santri?kelas_id=&jenis_kelamin=&tingkatan=&status=&page=1&limit=20&cursor=` — filter & grouping, scoped by role, cursor-based pagination
- `GET /api/santri/:id` — profil + histori catatan disiplin (buat rapor)
- `POST /api/santri` / `PUT /api/santri/:id`
- `DELETE /api/santri/:id` — soft delete
- `POST /api/santri/bulk` — bulk import (CSV/JSON)
- `GET /api/santri/:id/export` — export data santri (CSV/Excel)

**Catatan Disiplin**

- `GET /api/catatan?santri_id=&tipe=&kelas_id=&page=1&limit=20&cursor=`
- `GET /api/catatan/:id`
- `POST /api/catatan`
- `PUT /api/catatan/:id` / `DELETE /api/catatan/:id` — soft delete
- `POST /api/catatan/bulk` — bulk create

**Sync**

- `POST /api/sync` — batch push perubahan dari client dengan conflict detection, return mapping id lokal → id resmi + conflicts
- `GET /api/sync/pull?since=timestamp&cursor=` — pull perubahan terbaru dari server, cursor-based streaming
- `GET /api/sync/conflicts` — list unresolved conflicts (scoped by user)
- `POST /api/sync/conflicts/:id/resolve` — resolve conflict (choose client/server/merge)

**Dashboard**

- `GET /api/dashboard/summary` — jumlah pelanggaran per kategori, tren per kelas, top list
- `GET /api/dashboard/trends?period=7d` — trend data line chart
- `GET /api/dashboard/export` — export all dashboard data (CSV/PDF)

**Settings**

- `GET /api/settings` — get all settings (admin only)
- `PUT /api/settings/:key` — update setting (admin only)

-----

## 6. Arsitektur Infra (Full Cloudflare)

```
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Worker (Single)                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Hono Router + Middleware Layer                 │   │
│  │  - Auth (JWT verify + refresh)                  │   │
│  │  - Role/Scope check                             │   │
│  │  - Rate limiting (per endpoint)                 │   │
│  │  - Input validation (Zod schemas)               │   │
│  │  - Error handling + logging                     │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                               │
│  ┌─────────────────────▼───────────────────────────┐   │
│  │  Business Logic Layer                           │   │
│  │  - Sync orchestration                           │   │
│  │  - Conflict detection & resolution              │   │
│  │  - Audit logging                                │   │
│  │  - Data aggregation                             │   │
│  └─────────────────────┬───────────────────────────┘   │
└────────────────────────┼───────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        │                                 │
  ┌─────▼─────┐                   ┌──────▼─────┐
  │     D1     │                   │     R2     │
  │ (database) │                   │ (foto)     │
  └────────────┘                   └────────────┘
        │
  ┌─────▼──────────────────────────────────┐
  │ Cloudflare Analytics + Logpush         │
  │ - Performance monitoring               │
  │ - Error tracking                       │
  │ - Usage analytics                      │
  └────────────────────────────────────────┘
```

- **Single Worker** serve frontend (via Assets binding) + API (`/api/*`), satu deployment, satu domain.
- **D1** sebagai satu-satunya sumber data utama dengan proper indexing.
- **R2** untuk foto santri dengan signed URL untuk upload/download.
- **Auth**: JWT dengan **refresh token rotation**, access token (15min), refresh token (7d). Disimpan di httpOnly cookies untuk security.
- **Rate Limiting**: Per endpoint, per user (100 req/min default, auth endpoints 10 req/min).

### Security Measures

- **Password Hashing**: bcrypt dengan cost factor 12
- **JWT Secret**: Disimpan di Cloudflare Workers Secrets (environment variables)
- **CORS**: Configured untuk prod domain + localhost dev
- **Input Validation**: Zod schemas untuk semua input
- **SQL Injection Prevention**: Parameterized queries via D1 API
- **XSS Protection**: Content-Security-Policy headers
- **CSRF Protection**: SameSite cookies + CSRF tokens untuk state-changing ops
- **IP-based blocking**: Untuk brute force prevention

### Client-side (Offline-first)

- **IndexedDB** menyimpan seluruh data santri/catatan sebagai cache lokal dengan **Dexie.js** wrapper.
- **Local Schema**: Mirror server schema + tambah `sync_status` (pending/synced/conflict), `local_id`, `last_sync_attempt`.
- Semua write (create/update) langsung ke IndexedDB dulu, ditandai `pending`, ditambah ke sync queue.
- **Sync Queue**: Background sync dengan Service Worker + **exponential backoff** (1s, 2s, 4s, ... max 5min).
- **Conflict Resolution**: Automatic conflict detection, user diminta resolve kalau conflict terdeteksi.
- **Offline UI**: Indikator connection status, queue info, conflict notifications.
- **PDF Generation**: jsPDF + autoTable untuk rapor per santri.
- **Progressive Web App**: Service Worker untuk offline capability + app manifest.

### Data Sync Strategy

**Push Sync**:
1. Client kirim batch pending changes ke `/api/sync`
2. Server validate + cek version untuk conflict detection
3. Kalau no conflict: apply changes + increment version + return success
4. Kalau conflict: buat record di `sync_conflicts` + return conflict info
5. Client update local state: synced = success, conflict = tampilkan UI

**Pull Sync**:
1. Client request `/api/sync/pull?since=timestamp&cursor=`
2. Server kirim changes dalam **chunks** (cursor-based streaming)
3. Client apply changes ke IndexedDB (merge strategy)
4. Repeat sampai server return `has_more: false`

**Conflict Types**:
- **Version Mismatch**: Client dan server edit record yang sama
- **Deleted Conflict**: Satu pihak delete, lain edit
- **Duplicate Create**: Sama-sama create record dengan "same" data (fuzzy matching)

### Monitoring & Observability

- **Cloudflare Analytics**: Request metrics, error rates, latency
- **Logpush**: Export logs ke external service (Sentry, Datadog)
- **Custom Metrics**: Track sync success rate, conflict rate, offline time
- **Health Check**: `/health` endpoint untuk monitoring

-----

## 7. Struktur Project

```
santri-manajemen/
├── src/
│   ├── worker.ts              # entry point Worker, Hono setup
│   ├── routes/
│   │   ├── auth.ts            # register, login, refresh, logout
│   │   ├── admin.ts           # user management, audit log
│   │   ├── santri.ts          # CRUD santri, bulk operations
│   │   ├── kelas.ts           # CRUD kelas
│   │   ├── catatan.ts         # CRUD catatan disiplin
│   │   ├── kategori.ts        # CRUD kategori pelanggaran
│   │   ├── sync.ts            # sync orchestration, conflict resolution
│   │   ├── dashboard.ts       # analytics, trends, export
│   │   └── settings.ts        # settings management
│   ├── middleware/
│   │   ├── auth.ts            # JWT verify, token refresh
│   │   ├── rbac.ts            # role-based access control
│   │   ├── validation.ts      # Zod schemas validation
│   │   ├── rate-limit.ts      # rate limiting per endpoint
│   │   └── error-handler.ts   # global error handling
│   ├── services/
│   │   ├── sync.service.ts    # sync logic, conflict detection
│   │   ├── audit.service.ts   # audit logging
│   │   ├── cache.service.ts   # response caching (optional)
│   │   └── export.service.ts  # PDF/CSV generation
│   ├── db/
│   │   ├── schema.sql         # D1 schema
│   │   ├── migrations/        # schema migrations
│   │   └── seeds/             # seed data for dev
│   ├── utils/
│   │   ├── crypto.ts          # password hashing, JWT signing
│   │   ├── pagination.ts      # cursor-based pagination
│   │   └── logger.ts          # structured logging
│   └── types/
│       └── index.d.ts         # TypeScript type definitions
├── frontend/
│   ├── src/
│   │   ├── main.ts            # Vue app entry
│   │   ├── App.vue            # root component
│   │   ├── router/
│   │   │   └── index.ts       # Vue Router config
│   │   ├── stores/
│   │   │   ├── auth.ts        # Pinia auth store
│   │   │   ├── santri.ts      # Pinia santri store
│   │   │   └── sync.ts        # Pinia sync store
│   │   ├── components/
│   │   │   ├── auth/          # auth components
│   │   │   ├── santri/        # santri components
│   │   │   ├── dashboard/     # dashboard components
│   │   │   └── shared/        # shared components
│   │   ├── services/
│   │   │   ├── api.ts         # API client with error handling
│   │   │   ├── offline.ts     # offline detection & handling
│   │   │   └── export.ts      # PDF generation
│   │   ├── db/
│   │   │   ├── dexie.ts       # Dexie.js setup
│   │   │   └── schema.ts      # IndexedDB schema
│   │   ├── sync/
│   │   │   ├── queue.ts       # sync queue management
│   │   │   └── conflict.ts    # conflict resolution UI
│   │   └── utils/
│   │       ├── validation.ts  # form validation
│   │       └── format.ts      # data formatting
│   ├── public/
│   │   ├── sw.js              # Service Worker for offline
│   │   └── manifest.json      # PWA manifest
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.js
├── tests/
│   ├── unit/                  # Vitest unit tests
│   ├── integration/           # API integration tests
│   └── e2e/                   # Playwright E2E tests
├── wrangler.toml
├── package.json
├── tsconfig.json
├── .github/
│   └── workflows/
│       ├── ci.yml             # CI/CD pipeline
│       └── deploy.yml         # deployment automation
└── docs/
    ├── api.md                 # API documentation
    ├── deployment.md          # deployment guide
    └── troubleshooting.md     # common issues & solutions
```

-----

## 8. Fase Development

### Fase 0: Project Setup & Infrastructure (Week 1)
- Setup project structure + tooling (Vite, TypeScript, Vitest, Playwright)
- Configure CI/CD pipeline (GitHub Actions)
- Setup Cloudflare Workers + D1 + R2
- Configure wrangler.toml + environment variables
- Setup monitoring (Sentry error tracking)
- Define coding standards + linter rules (ESLint + Prettier)

### Fase 1: Auth & User Management (Week 2-3)
- Implement D1 schema (all tables)
- Implement auth endpoints (register, login, refresh, logout)
- Implement JWT middleware + role-based access control
- Implement rate limiting for auth endpoints
- Build admin dashboard untuk approve ustadz
- Implement audit logging system
- Unit tests + integration tests untuk auth flow

### Fase 2: Core Data Model (Week 4-5)
- Implement CRUD untuk kelas (admin only)
- Implement CRUD untuk santri dengan filtering/pagination
- Implement scoping data per ustadz (kelas yang dipegang)
- Implement bulk import santri (CSV/Excel)
- Implement export santri data
- Build basic UI untuk manajemen santri
- Unit tests + integration tests

### Fase 3: Catatan Disiplin & Kategori (Week 6-7)
- Implement CRUD untuk kategori pelanggaran
- Implement CRUD untuk catatan disiplin
- Implement validation rules (required fields, data types)
- Implement soft delete untuk catatan
- Build UI untuk input catatan disiplin
- Implement rapor generation per santri
- Unit tests + integration tests

### Fase 4: Offline-First Layer (Week 8-10)
- Setup IndexedDB dengan Dexie.js
- Implement sync queue management
- Implement push sync dengan conflict detection
- Implement pull sync dengan cursor-based streaming
- Implement conflict resolution UI
- Setup Service Worker untuk offline capability
- Implement PWA manifest
- Extensive testing untuk sync scenarios

### Fase 5: Dashboard & Reporting (Week 11-12)
- Implement analytics aggregation queries
- Build dashboard UI dengan charts
- Implement trend analysis
- Implement export dashboard data (CSV/PDF)
- Implement per-kelas reporting
- Performance optimization untuk dashboard queries

### Fase 6: Polish & Production Readiness (Week 13-14)
- Implement error handling + user-friendly error messages
- Add loading states + skeleton screens
- Accessibility audit + fixes
- Performance optimization (lazy loading, code splitting)
- Security audit + fixes
- Load testing + stress testing
- Documentation (API docs, deployment guide)
- Staging deployment + UAT

### Fase 7: Launch & Monitoring (Week 15+)
- Production deployment
- Monitor sync success rate
- Monitor conflict rate
- Gather user feedback
- Iterate based on feedback
- Plan phase 2 features

-----

## 9. Open Items & Future Enhancements

### Phase 2 Features (Post-MVP)
- Upload foto santri via R2 dengan signed URLs
- Notifikasi ke admin saat ada akun pending (email/in-app)
- Advanced filtering & search untuk semua data
- Data archiving system untuk alumni
- Advanced conflict resolution (auto-merge untuk non-critical fields)
- Multi-language support (i18n)
- Dark mode
- Mobile apps (React Native/Capacitor)

### Infrastructure Improvements
- Automated daily backup ke R2
- Multi-region deployment untuk low latency
- CDN caching strategy optimization
- Advanced rate limiting (adaptive based on user behavior)
- Custom domain + SSL configuration

### Compliance & Governance
- Data retention policy configuration
- GDPR compliance features (data export, deletion)
- Access control enhancement (IP whitelist, time-based access)
- Advanced audit trail reporting
- Compliance reports generation

### Performance Optimization
- Response caching untuk read-heavy endpoints
- Database query optimization & indexing strategy
- Implement read replicas (jika D1 mendukung di masa depan)
- Edge caching untuk static assets
- Bundle size optimization (code splitting, tree shaking)

### Security Enhancements
- 2FA (Two-Factor Authentication) support
- IP-based rate limiting + blocking
- Advanced password policies
- Session management improvements
- Security headers hardening

### Developer Experience
- API documentation dengan OpenAPI/Swagger
- Admin CLI untuk bulk operations
- Webhook integrations
- Plugin system untuk custom business logic
- Advanced monitoring & alerting

-----

## 10. Non-Functional Requirements

### Performance
- API response time: < 200ms (p95) untuk standard operations
- First Contentful Paint (FCP): < 1.5s
- Time to Interactive (TTI): < 3s
- Sync operation: < 5s untuk 100 records
- Support 100+ concurrent users tanpa degradation

### Scalability
- Handle 10,000+ santri records
- Handle 100,000+ catatan disiplin records
- Horizontal scalability via Cloudflare Workers (auto-scaling)
- Database query optimization dengan proper indexing

### Reliability
- System uptime: 99.5% (22 hours/month downtime allowed)
- Sync success rate: > 99%
- Automatic retry untuk failed sync operations
- Graceful degradation saat offline

### Security
- Password security: bcrypt dengan cost factor 12
- JWT security: RS256 signing, short-lived access tokens
- Data encryption: TLS 1.3 untuk semua communications
- SQL injection prevention via parameterized queries
- XSS protection via CSP headers + input sanitization
- CSRF protection via SameSite cookies + tokens

### Usability
- Mobile-first design (320px+ viewport)
- Touch-friendly UI (minimum 44px tap targets)
- Offline capability dengan clear status indicators
- Intuitive conflict resolution flow
- Accessibility: WCAG 2.1 AA compliant

### Maintainability
- Code coverage: > 80% untuk critical paths
- Documentation: API docs + code comments + deployment guide
- Modular architecture untuk easy feature additions
- Type safety via TypeScript
- Automated testing (unit, integration, E2E)

### Compatibility
- Browser support: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- PWA support: Service Workers, manifest, offline capability
- Progressive enhancement: Works without JavaScript (basic)
- Mobile OS: iOS 14+, Android 10+

-----

## 11. Risk Mitigation

### Technical Risks

**Risk**: Sync conflicts menyebabkan data loss
**Mitigation**: Version control + conflict detection + manual resolution UI + regular backups

**Risk**: IndexedDB quota exceeded
**Mitigation**: Implement data pruning strategy (archive old records), regular cleanup

**Risk**: D1 database limits hit
**Mitigation**: Monitor query performance, optimize indexes, implement caching layer

**Risk**: Offline sync failures
**Mitigation**: Exponential backoff retry, queue persistence, user notifications

**Risk**: Mobile browser compatibility issues
**Mitigation**: Extensive cross-browser testing, polyfills untuk unsupported features

### Business Risks

**Risk**: Low adoption oleh ustadz (complex UI)
**Mitigation**: User testing, iterative design, comprehensive training, feedback loops

**Risk**: Data integrity issues (incorrect input)
**Mitigation**: Input validation, business rules enforcement, audit trail

**Risk**: Security breach (unauthorized access)
**Mitigation**: Security audits, penetration testing, principle of least privilege

### Operational Risks

**Risk**: Deployment downtime
**Mitigation**: Blue-green deployment, rollback procedures, staging environment testing

**Risk**: Poor performance under load
**Mitigation**: Load testing, performance monitoring, auto-scaling configuration

**Risk**: Data loss (backup failure)
**Mitigation**: Automated daily backups, backup verification, disaster recovery plan

-----

## 12. Success Metrics

### Adoption Metrics
- Number of active ustadz users
- Number of santri records created
- Daily active users (DAU)
- Weekly active users (WAU)

### Engagement Metrics
- Average number of catatan per ustadz per day
- Sync success rate
- Offline usage percentage
- Feature usage breakdown

### Quality Metrics
- API error rate (< 1%)
- Sync conflict rate (< 5%)
- User-reported issues count
- System uptime percentage

### Performance Metrics
- Average API response time
- Page load time
- Sync operation time
- Database query performance

-----

## 13. Deployment Strategy

### Environment Setup
- **Development**: Local Wrangler dev server + local D1
- **Staging**: Cloudflare Workers staging environment + staging D1
- **Production**: Cloudflare Workers production + production D1

### Deployment Process
1. Create feature branch dari `main`
2. Implement + test locally (unit + integration tests)
3. Create PR ke `main` dengan required reviews
4. CI/CD pipeline runs all tests + linters
5. Deploy to staging environment
6. QA testing di staging
7. Deploy to production via GitHub Actions
8. Post-deployment smoke tests
9. Monitor for issues (Sentry alerts)

### Rollback Strategy
- Keep previous deployment versions
- Automated rollback via GitHub Actions
- Database migrations designed to be reversible
- Monitor for 1 hour post-deployment before confirming

-----

**End of PRD v2 — Ready for development with enhanced security, sync robustness, and production readiness**
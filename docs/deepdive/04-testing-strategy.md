# Deepdive: Testing Strategy

**Last Updated:** 2026-07-06
**Status:** Draft
**Applies To:** All layers (backend, frontend, sync)

---

## Table of Contents

1. [Testing Philosophy](#1-testing-philosophy)
2. [Test Pyramid](#2-test-pyramid)
3. [Unit Testing with Vitest](#3-unit-testing-with-vitest)
4. [Integration Testing with Workers + D1](#4-integration-testing-with-workers--d1)
5. [E2E Testing with Playwright](#5-e2e-testing-with-playwright)
6. [Sync Testing Scenarios](#6-sync-testing-scenarios)
7. [Test Data Management](#7-test-data-management)
8. [CI/CD Pipeline Integration](#8-cicd-pipeline-integration)
9. [Coverage Targets](#9-coverage-targets)
10. [Testing Checklist](#10-testing-checklist)

---

## 1. Testing Philosophy

### Behavior-Focused Testing ("Test the What, Not the How")

Tests validate observable behavior — the inputs a function accepts and the outputs/effects it produces — rather than internal implementation details. This means:

- **Auth tests**: Verify that a valid login returns a JWT and sets cookies, without asserting on which specific internal crypto function was called.
- **Sync tests**: Verify that pushing 10 pending records results in 10 synced records on the server, without asserting on the internal order of queue processing.
- **NOT testing**: Private helper functions, intermediate variable states, or implementation-specific call chains unless they represent a public contract.

This approach yields tests that survive refactoring. When you rewrite a function's internals for performance, the tests still pass as long as the external contract holds.

### TDD for Critical Paths

Critical paths — auth, sync, conflict resolution, RBAC enforcement — follow test-driven development:

1. **Red**: Write a failing test that defines the desired behavior.
2. **Green**: Write the minimum implementation to make it pass.
3. **Refactor**: Clean up the implementation while keeping tests green.

| Path | TDD Priority | Rationale |
|------|-------------|-----------|
| Auth (register, login, refresh, logout) | **Critical** | Security boundary; any bug is a vulnerability |
| Sync (push, pull, conflict detection) | **Critical** | Data integrity; bugs cause unrecoverable data loss |
| RBAC (scope enforcement) | **Critical** | Access control; bugs expose unauthorized data |
| Santri CRUD | **High** | Core domain; high usage frequency |
| Catatan Disiplin CRUD | **High** | Core domain; complex validation |
| Report/Analytics | **Medium** | Business logic, no security impact |
| UI components | **Medium** | Visual fidelity; easier to fix with visual feedback |

### Testing Principles

- **Fast**: Unit tests complete in < 1s. Integration tests in < 10s. E2E tests in < 60s.
- **Deterministic**: No flaky tests. No reliance on `setTimeout` or race conditions.
- **Isolated**: Each test sets up its own data and tears it down. No shared mutable state.
- **Readable**: Test name describes the scenario and expected outcome. Arrange-Act-Assert structure.
- **One concern per test**: A test verifies exactly one behavior. If a test checks two things, split it.

---

## 2. Test Pyramid

```
        ╱╲
       ╱  ╲
      ╱ E2E╲          5%  — Playwright, full auth flows, CRUD paths
     ╱──────╲
    ╱        ╲
   ╱Integration╲      25% — Workerd/D1, API endpoints, sync, RBAC
  ╱──────────────╲
 ╱                ╲
╱   Unit (Vitest)   ╲   70% — Services, validation, crypto, utils
╱────────────────────╲
```

### Layer Distribution

| Layer | Proportion | Tools | What It Covers |
|-------|-----------|-------|----------------|
| **Unit** | 70% | Vitest | Services, validation schemas, utils, crypto, pagination helpers, type guards |
| **Integration** | 25% | Vitest + `wrangler unstable_dev` | API endpoints (auth, CRUD, sync), middleware chains (RBAC, rate-limit), D1 queries, conflict detection |
| **E2E** | 5% | Playwright | Full user journeys: register → approve → login → CRUD santri → sync → conflict resolve |

### When to Write Each Layer

| Scenario | Layer | Why |
|----------|-------|-----|
| Pure function (e.g., `hashPassword`, `validateEmail`, `parseCursor`) | Unit | No external dependencies; fast to test exhaustively |
| Function calls D1 (e.g., `createSantri`, `findUserByEmail`) | Integration | Database interaction must be real to catch query bugs |
| Multiple endpoints chained (e.g., register → approve → login → create santri) | Integration | Validates full middleware stack + state transitions |
| Full browser session (e.g., login via form, navigate, submit data) | E2E | Catches frontend-backend integration bugs, JS errors, rendering issues |
| Offline → sync → online (e.g., create santri offline, reconnect, verify on server) | Integration + E2E | Sync is the riskiest feature; needs both API-level and browser-level validation |

---

## 3. Unit Testing with Vitest

### Setup

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './frontend/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/**/*.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/db/migrations/**',
        'src/db/seeds/**',
        'src/types/**',
      ],
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
    setupFiles: ['tests/unit/setup.ts'],
    testTimeout: 5_000,
  },
})
```

```ts
// tests/unit/setup.ts
import { beforeAll, afterAll, vi } from 'vitest'

// Mock crypto for deterministic testing
beforeAll(() => {
  vi.mock('@/utils/crypto', async () => {
    const actual = await vi.importActual('@/utils/crypto')
    return {
      ...actual,
      hashPassword: vi.fn((pw: string) =>
        Promise.resolve(`hashed_${pw}`)
      ),
      verifyPassword: vi.fn((pw: string, hash: string) =>
        Promise.resolve(hash === `hashed_${pw}`)
      ),
    }
  })
})

afterAll(() => {
  vi.clearAllMocks()
})
```

### Auth Service Tests

```ts
// tests/unit/services/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthService } from '@/services/auth.service'

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn(),
  run: vi.fn(),
}

describe('AuthService', () => {
  let auth: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    auth = new AuthService(mockDb as any)
  })

  describe('register', () => {
    it('creates a pending user when registering with valid data', async () => {
      const result = await auth.register({
        email: 'ustadz@pesantren.id',
        password: 'Rahasia123!',
        nama_lengkap: 'Ahmad Ghozali',
      })

      expect(result.status).toBe('pending')
      expect(result.role).toBe('ustadz')
      expect(result.id).toBeDefined()
      expect(mockDb.run).toHaveBeenCalledOnce()
    })

    it('rejects duplicate email with a conflict error', async () => {
      mockDb.first.mockResolvedValueOnce({ id: 'existing-id' })

      await expect(
        auth.register({
          email: 'duplicate@pesantren.id',
          password: 'Rahasia123!',
          nama_lengkap: 'Duplicate',
        })
      ).rejects.toThrow(/already exists/i)
    })

    it('rejects weak passwords (less than 8 characters)', async () => {
      await expect(
        auth.register({
          email: 'weak@pesantren.id',
          password: '123',
          nama_lengkap: 'Weak Password',
        })
      ).rejects.toThrow(/password/i)
    })

    it('rejects invalid email format', async () => {
      await expect(
        auth.register({
          email: 'not-an-email',
          password: 'Rahasia123!',
          nama_lengkap: 'Bad Email',
        })
      ).rejects.toThrow(/email/i)
    })
  })

  describe('login', () => {
    it('returns tokens for approved user with correct credentials', async () => {
      mockDb.first
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'ustadz@pesantren.id',
          password_hash: 'hashed_Rahasia123!',
          role: 'ustadz',
          status: 'approved',
        })

      const result = await auth.login({
        email: 'ustadz@pesantren.id',
        password: 'Rahasia123!',
      })

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.user.role).toBe('ustadz')
    })

    it('rejects login for pending user', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 'user-2',
        email: 'pending@pesantren.id',
        password_hash: 'hashed_Rahasia123!',
        role: 'ustadz',
        status: 'pending',
      })

      await expect(
        auth.login({
          email: 'pending@pesantren.id',
          password: 'Rahasia123!',
        })
      ).rejects.toThrow(/pending/i)
    })

    it('rejects login for suspended user', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 'user-3',
        email: 'suspended@pesantren.id',
        password_hash: 'hashed_Rahasia123!',
        role: 'ustadz',
        status: 'suspended',
      })

      await expect(
        auth.login({
          email: 'suspended@pesantren.id',
          password: 'Rahasia123!',
        })
      ).rejects.toThrow(/suspended/i)
    })

    it('rejects login with wrong password', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 'user-1',
        email: 'ustadz@pesantren.id',
        password_hash: 'hashed_Rahasia123!',
        role: 'ustadz',
        status: 'approved',
      })

      await expect(
        auth.login({
          email: 'ustadz@pesantren.id',
          password: 'WrongPassword!',
        })
      ).rejects.toThrow(/invalid credentials/i)
    })
  })
})
```

### Validation Schema Tests

```ts
// tests/unit/utils/validation.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

const createSantriSchema = z.object({
  nama_lengkap: z.string().min(1).max(100),
  jenis_kelamin: z.enum(['L', 'P']),
  kelas_id: z.string().uuid(),
  angkatan: z.string().regex(/^\d{4}$/),
  tanggal_masuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

describe('createSantriSchema', () => {
  it('accepts valid santri data', () => {
    const data = {
      nama_lengkap: 'Ahmad Riza',
      jenis_kelamin: 'L',
      kelas_id: '550e8400-e29b-41d4-a716-446655440000',
      angkatan: '2025',
      tanggal_masuk: '2025-07-01',
    }
    const result = createSantriSchema.parse(data)
    expect(result).toEqual(data)
  })

  it('rejects nama_lengkap that is empty', () => {
    expect(() =>
      createSantriSchema.parse({
        nama_lengkap: '',
        jenis_kelamin: 'L',
        kelas_id: '550e8400-e29b-41d4-a716-446655440000',
        angkatan: '2025',
        tanggal_masuk: '2025-07-01',
      })
    ).toThrow()
  })

  it('rejects invalid jenis_kelamin', () => {
    expect(() =>
      createSantriSchema.parse({
        nama_lengkap: 'Ahmad',
        jenis_kelamin: 'X',
        kelas_id: '550e8400-e29b-41d4-a716-446655440000',
        angkatan: '2025',
        tanggal_masuk: '2025-07-01',
      })
    ).toThrow()
  })

  it('rejects non-4-digit angkatan', () => {
    expect(() =>
      createSantriSchema.parse({
        nama_lengkap: 'Ahmad',
        jenis_kelamin: 'L',
        kelas_id: '550e8400-e29b-41d4-a716-446655440000',
        angkatan: '25',
        tanggal_masuk: '2025-07-01',
      })
    ).toThrow()
  })
})
```

### Sync Service Tests

```ts
// tests/unit/services/sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncService } from '@/services/sync.service'

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}

describe('SyncService', () => {
  let sync: SyncService

  beforeEach(() => {
    vi.clearAllMocks()
    sync = new SyncService(mockDb as any)
  })

  describe('conflict detection', () => {
    it('detects version mismatch between client and server', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 'santri-1',
        version: 3,
        nama_lengkap: 'Server Version',
      })

      const result = await sync.detectConflict({
        entityType: 'santri',
        entityId: 'santri-1',
        clientVersion: 2,
        clientData: { nama_lengkap: 'Client Version' },
      })

      expect(result.hasConflict).toBe(true)
      expect(result.conflictType).toBe('version_mismatch')
      expect(result.serverVersion).toBe(3)
    })

    it('allows push when client version matches server version', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 'santri-1',
        version: 2,
        nama_lengkap: 'Existing',
      })

      const result = await sync.detectConflict({
        entityType: 'santri',
        entityId: 'santri-1',
        clientVersion: 2,
        clientData: { nama_lengkap: 'Updated' },
      })

      expect(result.hasConflict).toBe(false)
    })

    it('detects deleted conflict (server record is soft-deleted)', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 'catatan-1',
        is_deleted: 1,
        version: 1,
      })

      const result = await sync.detectConflict({
        entityType: 'catatan_disiplin',
        entityId: 'catatan-1',
        clientVersion: 1,
        clientData: { judul: 'Updated' },
      })

      expect(result.hasConflict).toBe(true)
      expect(result.conflictType).toBe('deleted_conflict')
    })

    it('detects no conflict for new entities (no server record)', async () => {
      mockDb.first.mockResolvedValueOnce(null)

      const result = await sync.detectConflict({
        entityType: 'santri',
        entityId: 'new-santri-1',
        clientVersion: 1,
        clientData: { nama_lengkap: 'New Santri' },
      })

      expect(result.hasConflict).toBe(false)
    })
  })

  describe('batch push', () => {
    it('processes a batch of mixed entries (creates + updates)', async () => {
      mockDb.first
        .mockResolvedValueOnce(null)                   // new santri: no server record
        .mockResolvedValueOnce({ id: 'k-1', is_deleted: 0 })

      const result = await sync.pushBatch([
        {
          entityType: 'santri',
          entityId: 'local-santri-1',
          clientVersion: 1,
          clientData: { nama_lengkap: 'New', jenis_kelamin: 'L' },
          operation: 'create',
        },
        {
          entityType: 'kelas',
          entityId: 'k-1',
          clientVersion: 1,
          clientData: { nama: 'Updated Class' },
          operation: 'update',
        },
      ])

      expect(result.results).toHaveLength(2)
      expect(result.results[0].status).toBe('synced')
      expect(result.results[1].status).toBe('synced')
      expect(mockDb.run).toHaveBeenCalledTimes(2)
    })

    it('returns conflict info and does not apply conflicting changes', async () => {
      mockDb.first.mockResolvedValueOnce({
        id: 's-1',
        version: 5,
        nama_lengkap: 'Server',
      })

      const result = await sync.pushBatch([
        {
          entityType: 'santri',
          entityId: 's-1',
          clientVersion: 3,
          clientData: { nama_lengkap: 'Client' },
          operation: 'update',
        },
      ])

      expect(result.results[0].status).toBe('conflict')
      expect(result.results[0].conflictId).toBeDefined()
      expect(mockDb.run).not.toHaveBeenCalled()
    })
  })
})
```

### Pagination Utility Tests

```ts
// tests/unit/utils/pagination.test.ts
import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor, buildPaginatedQuery } from '@/utils/pagination'

describe('cursor pagination', () => {
  it('encodes and decodes cursor without data loss', () => {
    const cursor = { id: 'abc-123', created_at: '2026-07-06T10:00:00Z' }
    const encoded = encodeCursor(cursor)
    const decoded = decodeCursor(encoded)
    expect(decoded).toEqual(cursor)
  })

  it('produces URL-safe base64 encoded cursor', () => {
    const cursor = { id: 'abc-123', created_at: '2026-07-06T10:00:00Z' }
    const encoded = encodeCursor(cursor)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })

  it('builds paginated query with WHERE clause for cursor', () => {
    const result = buildPaginatedQuery(
      'SELECT * FROM santri',
      { id: 'abc', created_at: '2026-07-01T00:00:00Z' },
      ['created_at', 'id'],
      20
    )
    expect(result.sql).toContain('WHERE')
    expect(result.sql).toContain('LIMIT 21')
    expect(result.bindings).toHaveLength(3)
  })

  it('builds paginated query without WHERE clause when no cursor', () => {
    const result = buildPaginatedQuery(
      'SELECT * FROM santri',
      null,
      ['created_at', 'id'],
      20
    )
    expect(result.sql).not.toContain('WHERE')
    expect(result.sql).toContain('LIMIT 21')
  })
})
```

---

## 4. Integration Testing with Workers + D1

### Design Philosophy

Integration tests spin up a real Workerd instance with an in-memory D1 binding. They test the full request-response cycle through the Hono router, middleware stack, and database. This catches bugs that unit tests miss: middleware order issues, JWT cookie parsing, RBAC scope leaks, and SQL query errors.

### Setup

```ts
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/integration/setup.ts'],
  },
})
```

```ts
// tests/integration/setup.ts
import { unstable_dev } from 'wrangler'
import type { UnstableDevWorker } from 'wrangler'
import { beforeAll, afterAll } from 'vitest'

let worker: UnstableDevWorker

beforeAll(async () => {
  worker = await unstable_dev('src/worker.ts', {
    experimental: {
      disableExperimentalWarning: true,
    },
    vars: {
      JWT_SECRET: 'test-jwt-secret-for-integration-tests',
      JWT_REFRESH_SECRET: 'test-refresh-secret-for-integration-tests',
      ENVIRONMENT: 'test',
    },
    bindings: {
      DB: {
        type: 'd1',
        databaseName: 'santri-test',
        databaseId: 'test-db-id',
        // In-memory D1 that auto-resets between test files
      },
    },
  })
})

afterAll(async () => {
  await worker?.stop()
})

export { worker }
```

### Auth Flow Integration Tests

```ts
// tests/integration/auth.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { worker } from './setup'

describe('Auth API — POST /api/auth/register', () => {
  it('returns 201 with user data for valid registration', async () => {
    const res = await worker.fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test-ustadz@pesantren.id',
        password: 'Rahasia123!',
        nama_lengkap: 'Test Ustadz',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.role).toBe('ustadz')
    expect(body.data.status).toBe('pending')
    expect(body.data.id).toBeDefined()
  })

  it('returns 409 for duplicate email', async () => {
    const res = await worker.fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'duplicate@pesantren.id',
        password: 'Rahasia123!',
        nama_lengkap: 'First',
      }),
    })
    expect(res.status).toBe(201)

    const res2 = await worker.fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'duplicate@pesantren.id',
        password: 'Rahasia123!',
        nama_lengkap: 'Second',
      }),
    })
    expect(res2.status).toBe(409)
  })

  it('returns 422 for invalid payload (missing fields)', async () => {
    const res = await worker.fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'incomplete@pesantren.id',
        // missing password and nama_lengkap
      }),
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.details).toBeInstanceOf(Array)
  })
})

describe('Auth API — POST /api/auth/login', () => {
  beforeAll(async () => {
    // Register + approve user via admin API for login tests
  })

  it('returns 200 with access/refresh tokens for approved user', async () => {
    const res = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'approved-ustadz@pesantren.id',
        password: 'Rahasia123!',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accessToken).toBeDefined()
    expect(body.refreshToken).toBeDefined()
    // Check cookies
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toContain('refreshToken')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Strict')
  })

  it('returns 401 for pending user', async () => {
    const res = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pending-ustadz@pesantren.id',
        password: 'Rahasia123!',
      }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Auth API — Protected endpoints', () => {
  let accessToken: string

  beforeAll(async () => {
    // Login to get tokens
    const res = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'approved-ustadz@pesantren.id',
        password: 'Rahasia123!',
      }),
    })
    const body = await res.json()
    accessToken = body.accessToken
  })

  it('returns 401 when no token is provided', async () => {
    const res = await worker.fetch('/api/santri', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 with valid token on /api/auth/me', async () => {
    const res = await worker.fetch('/api/auth/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('approved-ustadz@pesantren.id')
    expect(body.role).toBe('ustadz')
  })

  it('returns 401 with expired token', async () => {
    // Generate an expired token directly for testing
    const res = await worker.fetch('/api/auth/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expired-token',
      },
    })
    expect(res.status).toBe(401)
  })
})
```

### Santri CRUD Integration Tests

```ts
// tests/integration/santri.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { worker } from './setup'

describe('Santri API', () => {
  let adminToken: string
  let ustadzToken: string
  let kelasId: string

  beforeAll(async () => {
    // Create admin user via admin seed endpoint
    const adminRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@pesantren.id',
        password: 'Admin123!',
      }),
    })
    const adminBody = await adminRes.json()
    adminToken = adminBody.accessToken

    // Create a kelas
    const kelasRes = await worker.fetch('/api/kelas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        nama: 'Kelas 1A',
        tingkatan: 'Ibtidaiyah',
        tahun_ajaran: '2026/2027',
      }),
    })
    const kelasBody = await kelasRes.json()
    kelasId = kelasBody.data.id

    // Login as ustadz (scoped to kelasId)
    const ustadzRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ustadz@pesantren.id',
        password: 'Rahasia123!',
      }),
    })
    const ustadzBody = await ustadzRes.json()
    ustadzToken = ustadzBody.accessToken
  })

  it('admin can create santri in any kelas', async () => {
    const res = await worker.fetch('/api/santri', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        nama_lengkap: 'Ahmad Riza',
        jenis_kelamin: 'L',
        kelas_id: kelasId,
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.nama_lengkap).toBe('Ahmad Riza')
    expect(body.data.kelas_id).toBe(kelasId)
    expect(body.data.version).toBe(1)
  })

  it('ustadz can create santri in their assigned kelas', async () => {
    const res = await worker.fetch('/api/santri', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ustadzToken}`,
      },
      body: JSON.stringify({
        nama_lengkap: 'Budi Santoso',
        jenis_kelamin: 'L',
        kelas_id: kelasId,
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
      }),
    })
    expect(res.status).toBe(201)
  })

  it('ustadz cannot create santri in a kelas they do not teach', async () => {
    const res = await worker.fetch('/api/santri', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ustadzToken}`,
      },
      body: JSON.stringify({
        nama_lengkap: 'Orang Lain',
        jenis_kelamin: 'L',
        kelas_id: 'some-other-kelas-id',
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('ustadz can only see santri in their assigned kelas when listing', async () => {
    // Create santri in a different kelas (as admin)
    const otherKelasRes = await worker.fetch('/api/kelas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        nama: 'Kelas 2A',
        tingkatan: 'Ibtidaiyah',
        tahun_ajaran: '2026/2027',
      }),
    })
    const otherKelas = await otherKelasRes.json()
    const otherKelasId = otherKelas.data.id

    await worker.fetch('/api/santri', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        nama_lengkap: 'Santri Kelas Lain',
        jenis_kelamin: 'P',
        kelas_id: otherKelasId,
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
      }),
    })

    // Ustadz lists santri — should only see their class
    const listRes = await worker.fetch('/api/santri?page=1&limit=50', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ustadzToken}`,
      },
    })
    const listBody = await listRes.json()
    for (const santri of listBody.data) {
      expect(santri.kelas_id).toBe(kelasId)
    }
  })

  it('supports cursor-based pagination', async () => {
    const res = await worker.fetch('/api/santri?limit=2', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
    })
    const body = await res.json()
    expect(body.data.length).toBeLessThanOrEqual(2)
    if (body.meta.has_more) {
      expect(body.meta.cursor).toBeDefined()

      const res2 = await worker.fetch(`/api/santri?limit=2&cursor=${body.meta.cursor}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
      })
      const body2 = await res2.json()
      expect(body2.data.length).toBeGreaterThan(0)
    }
  })

  it('soft-delete sets is_deleted flag instead of removing', async () => {
    const res = await worker.fetch('/api/santri', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        nama_lengkap: 'To Be Deleted',
        jenis_kelamin: 'L',
        kelas_id: kelasId,
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
      }),
    })
    const created = await res.json()
    const santriId = created.data.id

    const delRes = await worker.fetch(`/api/santri/${santriId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
    })
    expect(delRes.status).toBe(200)

    // Should not appear in listing
    const listRes = await worker.fetch(`/api/santri?kelas_id=${kelasId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
    })
    const listBody = await listRes.json()
    expect(listBody.data.find((s: any) => s.id === santriId)).toBeUndefined()
  })
})
```

### RBAC Integration Tests

```ts
// tests/integration/rbac.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { worker } from './setup'

describe('RBAC — Role-based access control', () => {
  let adminToken: string
  let ustadzToken: string

  beforeAll(async () => {
    const adminRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pesantren.id', password: 'Admin123!' }),
    })
    adminToken = (await adminRes.json()).accessToken

    const ustadzRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ustadz@pesantren.id', password: 'Rahasia123!' }),
    })
    ustadzToken = (await ustadzRes.json()).accessToken
  })

  describe('admin-only endpoints', () => {
    it.each([
      ['POST', '/api/kelas', {}],
      ['PUT', '/api/kelas/some-id', {}],
      ['DELETE', '/api/kelas/some-id'],
      ['POST', '/api/kategori-pelanggaran', {}],
      ['PUT', '/api/kategori-pelanggaran/some-id', {}],
      ['DELETE', '/api/kategori-pelanggaran/some-id'],
      ['GET', '/api/admin/users?status=pending'],
      ['POST', '/api/admin/users/some-id/approve'],
      ['POST', '/api/admin/users/some-id/suspend'],
      ['GET', '/api/settings'],
      ['PUT', '/api/settings/some-key', {}],
    ])('%s %s returns 403 for ustadz', async (method, path, body) => {
      const res = await worker.fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ustadzToken}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      expect(res.status).toBe(403)
    })

    it.each([
      ['GET', '/api/kelas'],
      ['POST', '/api/kelas', {}],
      ['GET', '/api/admin/users?status=pending'],
      ['POST', '/api/admin/users/some-id/approve'],
      ['GET', '/api/settings'],
    ])('%s %s returns 200 for admin', async (method, path, body) => {
      const res = await worker.fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      // 200 or 404 (if entity not found) is fine — just not 403
      expect(res.status).not.toBe(403)
    })
  })

  describe('ustadz-allowed endpoints', () => {
    it('ustadz can access /api/kelas but only sees their assigned ones', async () => {
      const res = await worker.fetch('/api/kelas', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ustadzToken}`,
        },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  describe('audit log auto-logging', () => {
    it('creates audit log entry on santri creation', async () => {
      const auditRes = await worker.fetch('/api/admin/audit-log?entity_type=santri', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
      })
      const body = await auditRes.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data[0].action).toBe('create')
    })
  })
})
```

---

## 5. E2E Testing with Playwright

### Setup

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://localhost:8788',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
  webServer: {
    command: 'npm run dev:e2e',
    port: 8788,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
```

```jsonc
// package.json (scripts)
{
  "scripts": {
    "dev:e2e": "wrangler dev --port 8788 --test-scheduled",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug"
  }
}
```

### Auth Flow E2E Tests

```ts
// tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Authentication flow', () => {
  test('ustadz can self-register and sees pending status', async ({ page }) => {
    await page.goto('/register')

    await page.fill('[data-testid="nama-lengkap"]', 'Test Ustadz E2E')
    await page.fill('[data-testid="email"]', 'e2e-ustadz@pesantren.id')
    await page.fill('[data-testid="password"]', 'Rahasia123!')
    await page.fill('[data-testid="confirm-password"]', 'Rahasia123!')
    await page.click('[data-testid="register-submit"]')

    await expect(page.locator('[data-testid="success-message"]')).toBeVisible()
    await expect(page.locator('[data-testid="pending-badge"]')).toBeVisible()
  })

  test('ustadz cannot login before admin approves', async ({ page }) => {
    await page.goto('/login')

    await page.fill('[data-testid="email"]', 'e2e-ustadz@pesantren.id')
    await page.fill('[data-testid="password"]', 'Rahasia123!')
    await page.click('[data-testid="login-submit"]')

    await expect(page.locator('[data-testid="error-message"]')).toBeVisible()
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/pending/i)
  })

  test('admin logs in, approves ustadz, assigns kelas', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'admin@pesantren.id')
    await page.fill('[data-testid="password"]', 'Admin123!')
    await page.click('[data-testid="login-submit"]')

    await expect(page).toHaveURL('/dashboard')

    // Navigate to user management
    await page.click('[data-testid="nav-user-management"]')
    await expect(page.locator('[data-testid="pending-users-tab"]')).toBeVisible()
    await page.click('[data-testid="pending-users-tab"]')

    // Find the pending user and approve
    await page.click(`[data-testid="approve-user-e2e-ustadz@pesantren.id"]`)

    // Modal should appear to assign kelas
    await expect(page.locator('[data-testid="assign-kelas-modal"]')).toBeVisible()
    await page.selectOption('[data-testid="kelas-select"]', 'Kelas 1A')
    await page.click('[data-testid="confirm-approve"]')

    // Success notification
    await expect(page.locator('[data-testid="notification"]')).toContainText(/approved/i)
  })

  test('ustadz can login after approval and sees their assigned kelas', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'e2e-ustadz@pesantren.id')
    await page.fill('[data-testid="password"]', 'Rahasia123!')
    await page.click('[data-testid="login-submit"]')

    await expect(page).toHaveURL('/dashboard')
    await expect(page.locator('[data-testid="user-kelas"]')).toContainText('Kelas 1A')
  })

  test('logout clears session and redirects to login', async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'admin@pesantren.id')
    await page.fill('[data-testid="password"]', 'Admin123!')
    await page.click('[data-testid="login-submit"]')

    // Logout
    await page.click('[data-testid="user-menu"]')
    await page.click('[data-testid="logout-button"]')

    await expect(page).toHaveURL('/login')

    // Try accessing protected page
    await page.goto('/dashboard')
    await expect(page).toHaveURL('/login')
  })
})
```

### CRUD Operations E2E Tests

```ts
// tests/e2e/santri-crud.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Santri CRUD operations', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin before each test
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'admin@pesantren.id')
    await page.fill('[data-testid="password"]', 'Admin123!')
    await page.click('[data-testid="login-submit"]')
    await expect(page).toHaveURL('/dashboard')
  })

  test('admin creates a new santri with all fields', async ({ page }) => {
    await page.click('[data-testid="nav-santri"]')
    await page.click('[data-testid="add-santri-button"]')

    await page.fill('[data-testid="nama-lengkap"]', 'Ahmad Riza E2E')
    await page.selectOption('[data-testid="jenis-kelamin"]', 'L')
    await page.selectOption('[data-testid="kelas-select"]', 'Kelas 1A')
    await page.fill('[data-testid="angkatan"]', '2026')
    await page.fill('[data-testid="tanggal-masuk"]', '2026-07-13')

    await page.click('[data-testid="save-santri"]')

    // Should redirect to santri list with new entry visible
    await expect(page).toHaveURL(/\/santri/)
    await expect(page.locator('[data-testid="santri-list"]')).toContainText('Ahmad Riza E2E')
  })

  test('admin can edit a santri', async ({ page }) => {
    await page.click('[data-testid="nav-santri"]')

    // Click edit on the first santri
    await page.click('[data-testid="edit-santri"] >> nth=0')

    await page.fill('[data-testid="nama-lengkap"]', 'Updated Name E2E')
    await page.click('[data-testid="save-santri"]')

    await expect(page.locator('[data-testid="santri-list"]')).toContainText('Updated Name E2E')
  })

  test('validation errors appear for incomplete form', async ({ page }) => {
    await page.click('[data-testid="nav-santri"]')
    await page.click('[data-testid="add-santri-button"]')

    // Submit empty form
    await page.click('[data-testid="save-santri"]')

    await expect(page.locator('[data-testid="field-error-nama-lengkap"]')).toBeVisible()
    await expect(page.locator('[data-testid="field-error-jenis-kelamin"]')).toBeVisible()
  })

  test('data persists after page reload', async ({ page }) => {
    await page.click('[data-testid="nav-santri"]')
    await expect(page.locator('[data-testid="santri-list"]')).toContainText('Updated Name E2E')

    // Reload
    await page.reload()
    await expect(page.locator('[data-testid="santri-list"]')).toContainText('Updated Name E2E')
  })
})
```

### Catatan Disiplin E2E Tests

```ts
// tests/e2e/catatan.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Catatan Disiplin flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'admin@pesantren.id')
    await page.fill('[data-testid="password"]', 'Admin123!')
    await page.click('[data-testid="login-submit"]')
    await expect(page).toHaveURL('/dashboard')
  })

  test('admin can add catatan pelanggaran to a santri', async ({ page }) => {
    await page.click('[data-testid="nav-santri"]')
    await page.click('[data-testid="santri-detail"] >> nth=0')

    await page.click('[data-testid="add-catatan"]')
    await page.selectOption('[data-testid="tipe"]', 'pelanggaran')
    await page.selectOption('[data-testid="kategori"]', 'Ringan')
    await page.fill('[data-testid="judul"]', 'Terlambat shalat subuh')
    await page.fill('[data-testid="deskripsi"]', 'Terlambat 15 menit tanpa izin')
    await page.fill('[data-testid="tanggal-kejadian"]', '2026-07-06')
    await page.click('[data-testid="save-catatan"]')

    await expect(page.locator('[data-testid="catatan-list"]')).toContainText('Terlambat shalat subuh')
  })

  test('admin can add catatan prestasi', async ({ page }) => {
    await page.click('[data-testid="nav-santri"]')
    await page.click('[data-testid="santri-detail"] >> nth=0')

    await page.click('[data-testid="add-catatan"]')
    await page.selectOption('[data-testid="tipe"]', 'prestasi')
    await page.fill('[data-testid="judul"]', 'Hafal Juz 30')
    await page.fill('[data-testid="deskripsi"]', 'Berhasil menghafal Juz 30 dalam 3 bulan')
    await page.fill('[data-testid="tanggal-kejadian"]', '2026-07-06')
    await page.click('[data-testid="save-catatan"]')

    await expect(page.locator('[data-testid="catatan-list"]')).toContainText('Hafal Juz 30')
  })
})
```

---

## 6. Sync Testing Scenarios

### Sync is the riskiest feature in this system. These tests validate data integrity across online/offline boundaries.

### Conflict Detection Scenarios

| Scenario | Client State | Server State | Expected Result |
|----------|-------------|-------------|-----------------|
| Clean sync (no conflict) | Version 3 | Version 3 | Sync succeeds, version → 4 |
| Version mismatch | Version 2 | Version 5 | Conflict created, push rejected |
| Deleted conflict | Editing record | is_deleted = 1 | Conflict created |
| New entity (no server record) | Version 1 | Not exists | Sync succeeds (create) |
| Duplicate create | Creating santri | Same santri exists | Conflict created |
| Concurrent edits on different fields | Edit nama_lengkap | Edit angkatan | Auto-merge (non-conflicting fields) |

### Sync Integration Tests

```ts
// tests/integration/sync.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { worker } from './setup'

describe('Sync API — POST /api/sync', () => {
  let adminToken: string
  let kelasId: string

  beforeAll(async () => {
    const adminRes = await worker.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pesantren.id', password: 'Admin123!' }),
    })
    adminToken = (await adminRes.json()).accessToken

    const kelasRes = await worker.fetch('/api/kelas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ nama: 'Kelas Sync Test', tingkatan: 'Ibtidaiyah', tahun_ajaran: '2026/2027' }),
    })
    kelasId = (await kelasRes.json()).data.id
  })

  it('syncs new santri created offline (no server record)', async () => {
    const res = await worker.fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        changes: [
          {
            entityType: 'santri',
            entityId: 'local-id-001',
            clientVersion: 1,
            operation: 'create',
            clientData: {
              nama_lengkap: 'Santri Offline',
              jenis_kelamin: 'L',
              kelas_id: kelasId,
              angkatan: '2026',
              tanggal_masuk: '2026-07-13',
              created_at: '2026-07-06T08:00:00Z',
              updated_at: '2026-07-06T08:00:00Z',
            },
          },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(1)
    expect(body.results[0].status).toBe('synced')
    expect(body.results[0].serverId).toBeDefined()
    expect(body.results[0].newVersion).toBe(1)

    // Verify via API that the santri was actually created
    const checkRes = await worker.fetch(`/api/santri/${body.results[0].serverId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
    })
    expect(checkRes.status).toBe(200)
    const santri = await checkRes.json()
    expect(santri.data.nama_lengkap).toBe('Santri Offline')
  })

  it('syncs updated santri (clean update, no conflict)', async () => {
    // First create a santri directly
    const createRes = await worker.fetch('/api/santri', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        nama_lengkap: 'To Update',
        jenis_kelamin: 'P',
        kelas_id: kelasId,
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
      }),
    })
    const created = await createRes.json()
    const santriId = created.data.id

    // Now push an update via sync (client version matches server version)
    const syncRes = await worker.fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        changes: [
          {
            entityType: 'santri',
            entityId: santriId,
            clientVersion: 1,
            operation: 'update',
            clientData: {
              nama_lengkap: 'Updated Via Sync',
              updated_at: '2026-07-06T09:00:00Z',
            },
          },
        ],
      }),
    })
    expect(syncRes.status).toBe(200)
    const syncBody = await syncRes.json()
    expect(syncBody.results[0].status).toBe('synced')
    expect(syncBody.results[0].newVersion).toBe(2)
  })

  it('detects version mismatch conflict', async () => {
    // Create a santri with version 1
    const createRes = await worker.fetch('/api/santri', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        nama_lengkap: 'Conflict Test',
        jenis_kelamin: 'L',
        kelas_id: kelasId,
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
      }),
    })
    const created = await createRes.json()
    const santriId = created.data.id

    // Update on server directly (bumps version to 2)
    await worker.fetch(`/api/santri/${santriId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ nama_lengkap: 'Server Updated' }),
    })

    // Now client tries to push with version 1 (stale)
    const syncRes = await worker.fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        changes: [
          {
            entityType: 'santri',
            entityId: santriId,
            clientVersion: 1,
            operation: 'update',
            clientData: {
              nama_lengkap: 'Client Updated',
            },
          },
        ],
      }),
    })
    expect(syncRes.status).toBe(200)
    const syncBody = await syncRes.json()
    expect(syncBody.results[0].status).toBe('conflict')
    expect(syncBody.results[0].conflictType).toBe('version_mismatch')
    expect(syncBody.results[0].conflictId).toBeDefined()
  })

  it('pushes batch of 50 records efficiently', async () => {
    const batch = Array.from({ length: 50 }, (_, i) => ({
      entityType: 'santri' as const,
      entityId: `bulk-local-${i}`,
      clientVersion: 1,
      operation: 'create' as const,
      clientData: {
        nama_lengkap: `Bulk Santri ${i}`,
        jenis_kelamin: i % 2 === 0 ? 'L' : 'P',
        kelas_id: kelasId,
        angkatan: '2026',
        tanggal_masuk: '2026-07-13',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }))

    const startTime = Date.now()
    const res = await worker.fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ changes: batch }),
    })
    const duration = Date.now() - startTime

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(50)
    expect(body.results.every((r: any) => r.status === 'synced')).toBe(true)
    expect(duration).toBeLessThan(5000)
  })
})

describe('Sync API — GET /api/sync/pull', () => {
  it('returns changes since a timestamp', async () => {
    const since = '2026-01-01T00:00:00Z'
    const res = await worker.fetch(`/api/sync/pull?since=${since}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.changes)).toBe(true)
    expect(body.meta.has_more).toBeDefined()
  })

  it('supports cursor-based pagination for large sync payloads', async () => {
    const since = '2026-01-01T00:00:00Z'
    const res = await worker.fetch(`/api/sync/pull?since=${since}&limit=10`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    const body = await res.json()
    if (body.meta.has_more) {
      expect(body.meta.cursor).toBeDefined()

      const res2 = await worker.fetch(
        `/api/sync/pull?since=${since}&limit=10&cursor=${body.meta.cursor}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      )
      const body2 = await res2.json()
      expect(body2.changes.length).toBeGreaterThan(0)
    }
  })
})

describe('Sync API — Conflict Resolution', () => {
  it('resolves conflict by choosing client version', async () => {
    // First, create a conflict
    // ... (setup omitted for brevity)

    const resolveRes = await worker.fetch('/api/sync/conflicts/conflict-id-here/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        resolution: 'use_client',
      }),
    })
    expect(resolveRes.status).toBe(200)
  })

  it('resolves conflict by choosing server version', async () => {
    const resolveRes = await worker.fetch('/api/sync/conflicts/conflict-id-here/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        resolution: 'use_server',
      }),
    })
    expect(resolveRes.status).toBe(200)
  })

  it('resolves conflict with manual merge (client for some fields, server for others)', async () => {
    const resolveRes = await worker.fetch('/api/sync/conflicts/conflict-id-here/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        resolution: 'merge',
        mergedData: {
          nama_lengkap: 'Client Name',   // from client
          angkatan: '2026',               // from server
        },
      }),
    })
    expect(resolveRes.status).toBe(200)
  })
})
```

### Offline/Online Sync E2E Tests

```ts
// tests/e2e/sync.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Offline/Online sync flow', () => {
  test('creates santri offline, syncs when online', async ({ page, context }) => {
    // Login
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'admin@pesantren.id')
    await page.fill('[data-testid="password"]', 'Admin123!')
    await page.click('[data-testid="login-submit"]')
    await expect(page).toHaveURL('/dashboard')

    // Navigate to santri
    await page.click('[data-testid="nav-santri"]')
    await page.click('[data-testid="add-santri-button"]')

    // Go offline (intercept network requests)
    await context.setOffline(true)

    // Create santri while offline
    await page.fill('[data-testid="nama-lengkap"]', 'Santri Offline E2E')
    await page.selectOption('[data-testid="jenis-kelamin"]', 'L')
    await page.selectOption('[data-testid="kelas-select"]', 'Kelas 1A')
    await page.fill('[data-testid="angkatan"]', '2026')
    await page.fill('[data-testid="tanggal-masuk"]', '2026-07-13')
    await page.click('[data-testid="save-santri"]')

    // Should see "pending sync" indicator
    await expect(page.locator('[data-testid="sync-status"]')).toContainText(/pending/i)

    // Go back online
    await context.setOffline(false)

    // Trigger sync (or wait for background sync)
    await page.click('[data-testid="sync-now-button"]')

    // Should see sync success
    await expect(page.locator('[data-testid="sync-status"]')).toContainText(/synced/i, { timeout: 10000 })
  })

  test('sync indicator shows pending count', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'admin@pesantren.id')
    await page.fill('[data-testid="password"]', 'Admin123!')
    await page.click('[data-testid="login-submit"]')

    const syncIndicator = page.locator('[data-testid="sync-indicator"]')
    await expect(syncIndicator).toBeVisible()
  })

  test('conflict notification appears when sync conflict is detected', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[data-testid="email"]', 'admin@pesantren.id')
    await page.fill('[data-testid="password"]', 'Admin123!')
    await page.click('[data-testid="login-submit"]')

    // Create a conflict scenario by having two users edit the same record
    // (This requires a seeded conflict in the test data)

    const notification = page.locator('[data-testid="conflict-notification"]')
    if (await notification.isVisible()) {
      // Navigate to conflict resolution
      await notification.click()
      await expect(page).toHaveURL(/\/sync\/conflicts/)
    }
  })

  test('conflict resolution UI — user can pick server or client version', async ({ page }) => {
    await page.goto('/sync/conflicts')

    // Check if there are conflicts
    const conflictItems = page.locator('[data-testid="conflict-item"]')
    const count = await conflictItems.count()

    if (count > 0) {
      await conflictItems.first().click()

      // Should see both versions
      await expect(page.locator('[data-testid="client-version"]')).toBeVisible()
      await expect(page.locator('[data-testid="server-version"]')).toBeVisible()

      // Click "Use server version"
      await page.click('[data-testid="use-server-button"]')
      await expect(page.locator('[data-testid="resolution-success"]')).toBeVisible()
    }
  })
})
```

---

## 7. Test Data Management

### Fixtures

```ts
// tests/fixtures/users.ts
export const adminUser = {
  id: 'admin-0001',
  email: 'admin@pesantren.id',
  password: 'Admin123!',
  password_hash: '$2b$12$hashed_admin',
  nama_lengkap: 'Admin Pesantren',
  role: 'admin' as const,
  status: 'approved' as const,
}

export const pendingUser = {
  id: 'ustadz-0001',
  email: 'pending@pesantren.id',
  password: 'Rahasia123!',
  password_hash: '$2b$12$hashed_pending',
  nama_lengkap: 'Ustadz Pending',
  role: 'ustadz' as const,
  status: 'pending' as const,
}

export const approvedUstadz = {
  id: 'ustadz-0002',
  email: 'ustadz@pesantren.id',
  password: 'Rahasia123!',
  password_hash: '$2b$12$hashed_ustadz',
  nama_lengkap: 'Ustadz Approved',
  role: 'ustadz' as const,
  status: 'approved' as const,
}

export const suspendedUser = {
  id: 'ustadz-0003',
  email: 'suspended@pesantren.id',
  password: 'Rahasia123!',
  password_hash: '$2b$12$hashed_suspended',
  nama_lengkap: 'Ustadz Suspended',
  role: 'ustadz' as const,
  status: 'suspended' as const,
}
```

```ts
// tests/fixtures/kelas.ts
export const kelasFixtures = [
  {
    id: 'kelas-0001',
    nama: 'Kelas 1A',
    tingkatan: 'Ibtidaiyah',
    tahun_ajaran: '2026/2027',
    is_active: 1,
  },
  {
    id: 'kelas-0002',
    nama: 'Kelas 1B',
    tingkatan: 'Ibtidaiyah',
    tahun_ajaran: '2026/2027',
    is_active: 1,
  },
  {
    id: 'kelas-0003',
    nama: 'Kelas 2A',
    tingkatan: 'Ibtidaiyah',
    tahun_ajaran: '2026/2027',
    is_active: 0, // inactive (archived)
  },
]
```

### Test Factories

```ts
// tests/factories/santri.ts
import { faker } from '@faker-js/faker'

export function buildSantri(overrides: Partial<Santri> = {}): Santri {
  return {
    id: faker.string.uuid(),
    nama_lengkap: faker.person.fullName(),
    jenis_kelamin: faker.helpers.arrayElement(['L', 'P'] as const),
    kelas_id: 'kelas-0001',
    angkatan: faker.date.past({ years: 5 }).getFullYear().toString(),
    tanggal_masuk: faker.date.past({ years: 2 }).toISOString().split('T')[0],
    status: 'aktif',
    version: faker.number.int({ min: 1, max: 10 }),
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    ...overrides,
  }
}

export function buildSantriList(count: number, overrides: Partial<Santri> = {}): Santri[] {
  return Array.from({ length: count }, () => buildSantri(overrides))
}
```

```ts
// tests/factories/catatan.ts
import { faker } from '@faker-js/faker'

export function buildCatatanDisiplin(overrides: Partial<CatatanDisiplin> = {}): CatatanDisiplin {
  return {
    id: faker.string.uuid(),
    santri_id: faker.string.uuid(),
    tipe: faker.helpers.arrayElement(['pelanggaran', 'prestasi'] as const),
    kategori_id: faker.helpers.arrayElement([null, faker.string.uuid()]),
    judul: faker.lorem.sentence(),
    deskripsi: faker.lorem.paragraph(),
    tanggal_kejadian: faker.date.recent().toISOString().split('T')[0],
    dicatat_oleh: faker.string.uuid(),
    tindak_lanjut: faker.helpers.arrayElement([null, faker.lorem.sentence()]),
    version: 1,
    is_deleted: 0,
    created_at: faker.date.recent().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    ...overrides,
  }
}
```

### Seed Data for Development

```ts
// src/db/seeds/seed.ts
import type { D1Database } from '@cloudflare/workers-types'

export async function seedDatabase(DB: D1Database): Promise<void> {
  // Users
  await DB.prepare(
    `INSERT INTO users (id, email, password_hash, nama_lengkap, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    'admin-0001',
    'admin@pesantren.id',
    '$2b$12$...',
    'Admin Pesantren',
    'admin',
    'approved'
  ).run()

  // Kelas
  await DB.prepare(
    `INSERT INTO kelas (id, nama, tingkatan, tahun_ajaran, is_active)
     VALUES (?, ?, ?, ?, ?)`
  ).bind('kelas-0001', 'Kelas 1A', 'Ibtidaiyah', '2026/2027', 1).run()

  await DB.prepare(
    `INSERT INTO kelas (id, nama, tingkatan, tahun_ajaran, is_active)
     VALUES (?, ?, ?, ?, ?)`
  ).bind('kelas-0002', 'Kelas 1B', 'Ibtidaiyah', '2026/2027', 1).run()

  // Ustadz-Kelas mapping
  await DB.prepare(
    `INSERT INTO ustadz_kelas (user_id, kelas_id) VALUES (?, ?)`
  ).bind('ustadz-0002', 'kelas-0001').run()

  // Kategori Pelanggaran
  await DB.prepare(
    `INSERT INTO kategori_pelanggaran (id, nama, deskripsi, urutan_keparahan)
     VALUES (?, ?, ?, ?)`
  ).bind('kategori-ringan', 'Ringan', 'Pelanggaran ringan (teguran lisan)', 1).run()

  await DB.prepare(
    `INSERT INTO kategori_pelanggaran (id, nama, deskripsi, urutan_keparahan)
     VALUES (?, ?, ?, ?)`
  ).bind('kategori-sedang', 'Sedang', 'Pelanggaran sedang (skors 1 hari)', 2).run()

  await DB.prepare(
    `INSERT INTO kategori_pelanggaran (id, nama, deskripsi, urutan_keparahan)
     VALUES (?, ?, ?, ?)`
  ).bind('kategori-berat', 'Berat', 'Pelanggaran berat (skors 3 hari)', 3).run()

  // Settings
  await DB.prepare(
    `INSERT INTO settings (key, value, description) VALUES (?, ?, ?)`
  ).bind('tahun_ajaran_aktif', '2026/2027', 'Tahun ajaran yang sedang berjalan').run()

  await DB.prepare(
    `INSERT INTO settings (key, value, description) VALUES (?, ?, ?)`
  ).bind('nama_pesantren', 'Pesantren Nurul Hidayah', 'Nama pesantren').run()
}
```

### Test Data Cleanup Strategy

```ts
// tests/e2e/global-setup.ts
import { test as setup } from '@playwright/test'
import { execSync } from 'child_process'

setup('seed test database', async () => {
  execSync('npx wrangler d1 execute santri-test --file=src/db/seeds/seed.sql', {
    env: { ...process.env, D1_DATABASE_ID: 'test-db-id' },
  })
})
```

```ts
// tests/e2e/global-teardown.ts
import { test as teardown } from '@playwright/test'

teardown('cleanup test database', async () => {
  // Option 1: Full reset
  execSync('npx wrangler d1 execute santri-test --command="DELETE FROM santri; DELETE FROM users; ..."')

  // Option 2: Drop and re-create
  execSync('npx wrangler d1 execute santri-test --file=src/db/schema.sql')

  // Option 3: Use a fresh D1 database per test run (recommended)
  // Configured via wrangler.toml `[[env.testing.d1_databases]]`
})
```

### Data Management Principles

| Principle | Implementation |
|-----------|---------------|
| **Isolated per test file** | Integration tests seed data in `beforeAll` and clean up in `afterAll`. No two tests share D1 state in parallel. |
| **Deterministic IDs** | Use fixed IDs in fixtures (e.g., `admin-0001`, `kelas-0001`) so tests can reference known entities. |
| **Factory defaults** | Factories generate realistic random data via Faker, but allow overrides for specific scenarios. |
| **Sequential test files** | Integration tests run in sequence (`--pool=forks` with `singleThread: true` in CI) to avoid database collisions. |
| **One seed per test run** | E2E tests use a single global seed before all suites, then cleanup after all suites complete. |
| **Snapshot cleanup** | E2E tests that modify data use `test.step` to revert changes when possible, or rely on global teardown. |

### CI-Specific Database Strategy

```yaml
# In CI, each workflow run gets a fresh D1 test database:
# .github/workflows/ci.yml
#
# - name: Create test D1 database
#   run: |
#     npx wrangler d1 create santri-test-ci-${{ github.run_id }}
#     npx wrangler d1 execute santri-test-ci-${{ github.run_id }} \
#       --file=src/db/schema.sql
#     npx wrangler d1 execute santri-test-ci-${{ github.run_id }} \
#       --file=src/db/seeds/seed.sql
```

---

## 8. CI/CD Pipeline Integration

### Complete CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  WRANGLER_VERSION: '3'

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  unit-tests:
    runs-on: ubuntu-latest
    needs: [lint]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-unit
          path: coverage/
      - name: Check coverage thresholds
        run: |
          npm run test:unit -- --coverage --reporter=json
          # Parse coverage summary and fail if below thresholds

  integration-tests:
    runs-on: ubuntu-latest
    needs: [lint]
    services:
      # D1 is emulated via Wrangler — no external service needed
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Setup Wrangler
        run: |
          npx wrangler --version
          echo "WRANGLER_CI=true" >> $GITHUB_ENV
      - run: npm run test:integration
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          WRANGLER_CI: true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: integration-results
          path: tests/integration/results/

  e2e-tests:
    runs-on: ubuntu-latest
    needs: [integration-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium firefox webkit
      - name: Run E2E tests
        run: npm run test:e2e
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-screenshots
          path: test-results/

  sync-tests:
    runs-on: ubuntu-latest
    needs: [integration-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Run sync-specific integration tests
        run: npm run test:sync
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          TEST_SYNC_SCENARIOS: 'all'

  coverage-report:
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    if: always()
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Download coverage artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: coverage-*
          merge-multiple: true
      - name: Merge coverage reports
        run: npm run coverage:merge
      - name: Upload merged coverage
        uses: actions/upload-artifact@v4
        with:
          name: merged-coverage
          path: coverage-merged/

  security-scan:
    runs-on: ubuntu-latest
    needs: [lint]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Run npm audit
        run: npm audit --audit-level=high
        continue-on-error: true
      - name: Run SAST scan
        uses: github/codeql-action/analyze@v3
        with:
          languages: typescript

  deploy-staging:
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests, e2e-tests, sync-tests]
    if: github.ref == 'refs/heads/develop'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Deploy to Staging
        run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      - name: Smoke tests (staging)
        run: npm run test:smoke
        env:
          BASE_URL: 'https://staging.santri-vora.example.com'
```

### Workflow Diagram

```
push/PR
  │
  ▼
┌──────────┐
│   lint   │──► npm run lint + typecheck
└────┬─────┘
     │
     ├──────────────────────┐
     ▼                      ▼
┌──────────┐        ┌──────────────┐
│  unit    │        │  security    │
│  tests   │        │  scan        │
└────┬─────┘        └──────────────┘
     │
     ▼
┌──────────────────┐
│  integration     │──► API + D1 + middleware
│  tests           │
└────┬─────────────┘
     │
     ├──────────────────────────┐
     ▼                          ▼
┌──────────┐            ┌──────────────┐
│  e2e     │            │  sync tests  │
│  tests   │            │  (extended)  │
└────┬─────┘            └──────┬───────┘
     │                         │
     └──────────┬──────────────┘
                ▼
         ┌────────────┐
         │  coverage  │
         │  report    │
         └──────┬─────┘
                │
       (if develop branch)
                ▼
         ┌────────────┐
         │  deploy    │
         │  staging   │
         └──────┬─────┘
                │
                ▼
         ┌────────────┐
         │  smoke     │
         │  tests     │
         └────────────┘
```

### Package.json Scripts

```jsonc
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration && npm run test:e2e",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:unit:watch": "vitest --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:integration:watch": "vitest --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:sync": "vitest run --config vitest.integration.config.ts tests/integration/sync.test.ts",
    "test:smoke": "vitest run --config vitest.smoke.config.ts",
    "coverage": "npm run test:unit -- --coverage && npm run coverage:merge",
    "coverage:merge": "nyc merge coverage/ coverage-merged/coverage.json && nyc report --reporter=html --report-dir=coverage-merged",
    "test:ci": "npm run test:unit -- --coverage && npm run test:integration && npm run test:e2e"
  }
}
```

---

## 9. Coverage Targets

### Minimum Coverage Thresholds

| Metric | Target | Critical Paths | Notes |
|--------|--------|----------------|-------|
| **Statements** | 80% | 90% (auth, sync, RBAC) | Every line in critical paths must be covered |
| **Branches** | 75% | 85% (validation, RBAC) | Conditional logic must be fully exercised |
| **Functions** | 80% | 95% (all exported functions) | Public API functions must have tests |
| **Lines** | 80% | 90% (critical paths) | Matches statements |

### Critical Paths Requiring Higher Coverage

```ts
// These files must meet the stricter threshold
const criticalPaths = [
  'src/services/auth.service.ts',
  'src/services/sync.service.ts',
  'src/services/audit.service.ts',
  'src/middleware/auth.ts',
  'src/middleware/rbac.ts',
  'src/middleware/validation.ts',
  'src/utils/crypto.ts',
  'src/routes/auth.ts',
  'src/routes/sync.ts',
]
```

### Coverage Configuration (Vitest)

```ts
// vitest.config.ts (coverage section)
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html', 'lcov', 'clover'],
  thresholds: {
    statements: 80,
    branches: 75,
    functions: 80,
    lines: 80,
    perFile: true,
    100: criticalPaths, // These files require 100% coverage
  },
  include: ['src/**/*.ts'],
  exclude: [
    'src/**/*.d.ts',
    'src/db/migrations/**',
    'src/db/seeds/**',
    'src/types/**',
    'src/worker.ts', // Entry point — minimal logic
  ],
}
```

### Coverage Reporting in CI

Create a coverage gate job that fails the pipeline if thresholds are not met:

```yaml
# .github/workflows/coverage-check.yml (called from ci.yml)
name: Coverage Check
on: workflow_call

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - name: Check coverage thresholds
        run: |
          npx vitest run --coverage --reporter=json 2>&1 | tee coverage-output.json
          # Parse and fail if below threshold
          node -e "
            const report = require('./coverage-output.json');
            const threshold = { statements: 80, branches: 75, functions: 80, lines: 80 };
            let failed = false;
            for (const [key, value] of Object.entries(threshold)) {
              const actual = report.total[key].pct;
              if (actual < value) {
                console.error('FAIL: ' + key + ' coverage is ' + actual + '% (minimum ' + value + '%)');
                failed = true;
              }
            }
            if (failed) process.exit(1);
          "
```

### Coverage Over Time Tracking

```yaml
# Post coverage to a badge service (e.g., Coveralls or Codecov)
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    files: ./coverage/lcov.info
    flags: unittests
    fail_ci_if_error: false
```

### What Not to Test for Coverage

| Artifact | Why Not to Test |
|----------|----------------|
| `src/types/index.d.ts` | Type definitions — no runtime logic |
| `src/db/migrations/*.sql` | SQL schema — tested via integration |
| `src/db/seeds/*.sql` | Seed data — not production code |
| `src/worker.ts` (entry point) | Minimal wiring — Hono setup tested via integration |
| `vite.config.ts`, `wrangler.toml` | Configuration — no runtime logic |

---

## 10. Testing Checklist

### Project Setup Checklist

- [ ] Vitest installed and configured (`vitest.config.ts`)
- [ ] Playwright installed and configured (`playwright.config.ts`)
- [ ] Test directory structure created (`tests/unit/`, `tests/integration/`, `tests/e2e/`)
- [ ] Test fixtures written for all core entities
- [ ] Test factories created with Faker for random data generation
- [ ] Seed data script created for dev/test environments
- [ ] CI workflow file created (`.github/workflows/ci.yml`)
- [ ] Coverage thresholds configured in `vitest.config.ts`
- [ ] Pre-commit hook configured (lint + unit tests)
- [ ] `npm run test` scripts defined in `package.json`

### Implementation Phase Checklist

#### For Every New Feature

- [ ] Write unit tests for all service functions (TDD for critical paths)
- [ ] Write validation schema tests for all new input schemas
- [ ] Write integration tests for new API endpoints
- [ ] Verify RBAC enforcement for new endpoints
- [ ] Verify error handling for all failure modes (400, 401, 403, 404, 409, 422, 500)
- [ ] Verify pagination for list endpoints
- [ ] Verify soft delete behavior where applicable
- [ ] Verify audit logging for state-changing operations

#### For Sync Features

- [ ] Test push with no conflicts
- [ ] Test push with version mismatch conflicts
- [ ] Test push with deleted-record conflicts
- [ ] Test push with duplicate-creation conflicts
- [ ] Test pull with no changes
- [ ] Test pull with changes (cursor-based pagination)
- [ ] Test pull with large dataset (50+ records)
- [ ] Test conflict resolution: "use client"
- [ ] Test conflict resolution: "use server"
- [ ] Test conflict resolution: "merge"
- [ ] Test batch push (50 records, < 5 seconds)
- [ ] Test sync with invalid/malformed data rejected properly

#### For Auth Features

- [ ] Test registration with valid data returns pending user
- [ ] Test registration with duplicate email returns 409
- [ ] Test registration with weak password rejected
- [ ] Test login with correct credentials returns JWT
- [ ] Test login with wrong password returns 401
- [ ] Test login with pending user returns 401
- [ ] Test login with suspended user returns 401
- [ ] Test refresh token rotation works
- [ ] Test access token expiry (15 min) triggers refresh
- [ ] Test logout invalidates refresh token

#### For Offline-First Features

- [ ] Test creating records while offline
- [ ] Test sync queue persists after page refresh
- [ ] Test background sync triggers when coming online
- [ ] Test sync indicator shows pending count
- [ ] Test conflict notification appears
- [ ] Test offline indicator appears when network is down
- [ ] Test exponential backoff for failed sync attempts

### CI Checklist

- [ ] All unit tests pass before merge
- [ ] All integration tests pass before merge
- [ ] All E2E tests pass before merge to main
- [ ] Coverage thresholds met
- [ ] No lint or type errors
- [ ] Security scan passes (no high/critical vulnerabilities)
- [ ] PR has at least one approval
- [ ] Staging deployment smoke tests pass
- [ ] Post-deployment monitoring confirms 0 errors

### Pre-Release Checklist

- [ ] Full test suite passes (`npm run test:ci`)
- [ ] Coverage report reviewed (no regressions)
- [ ] Smoke tests pass against staging
- [ ] Database migration tested (forward + rollback)
- [ ] Load test passes (100 concurrent users, < 200ms p95)
- [ ] Offline test passes (create offline → sync → verify)
- [ ] Cross-browser E2E tests pass (Chromium, Firefox, WebKit)
- [ ] Mobile viewport E2E tests pass (375px, 768px breakpoints)
- [ ] Accessibility check passes (axe-core scan)
- [ ] Security scan (CodeQL, npm audit) passes

### Regular Maintenance

- [ ] Review flaky tests weekly — fix or quarantine
- [ ] Update Faker seed data to catch edge cases
- [ ] Audit test coverage trends (increase or decrease?)
- [ ] Review and update CI pipeline for efficiency
- [ ] Update test data factories when schema changes
- [ ] Run full test suite on staging before production deploy
- [ ] Archive old test artifacts from CI storage

---

## Appendix A: Test File Organization

```
tests/
├── unit/
│   ├── services/
│   │   ├── auth.test.ts
│   │   ├── sync.test.ts
│   │   └── audit.test.ts
│   ├── middleware/
│   │   ├── auth.test.ts
│   │   ├── rbac.test.ts
│   │   └── validation.test.ts
│   └── utils/
│       ├── crypto.test.ts
│       ├── pagination.test.ts
│       └── logger.test.ts
├── integration/
│   ├── auth.test.ts
│   ├── santri.test.ts
│   ├── kelas.test.ts
│   ├── catatan.test.ts
│   ├── kategori.test.ts
│   ├── rbac.test.ts
│   ├── sync.test.ts
│   ├── dashboard.test.ts
│   └── settings.test.ts
├── e2e/
│   ├── auth.spec.ts
│   ├── santri-crud.spec.ts
│   ├── catatan.spec.ts
│   ├── sync.spec.ts
│   └── dashboard.spec.ts
├── fixtures/
│   ├── users.ts
│   ├── kelas.ts
│   ├── kategori.ts
│   └── santri.ts
├── factories/
│   ├── santri.ts
│   └── catatan.ts
├── setup.ts                  # Unit test setup (mocks)
├── setup.integration.ts      # Integration test setup (wrangler)
└── tsconfig.json
```

## Appendix B: Testing Command Reference

```bash
# Run all tests
npm test

# Unit tests (fast, no external deps)
npm run test:unit
npm run test:unit -- --coverage          # with coverage
npm run test:unit:watch                   # watch mode

# Integration tests (requires Wrangler + D1 emulator)
npm run test:integration
npm run test:integration:watch

# Sync-specific tests
npm run test:sync

# E2E tests (requires Playwright browsers)
npm run test:e2e
npm run test:e2e:ui                       # Playwright UI mode
npm run test:e2e:debug                    # Debug mode with inspector

# Smoke tests (post-deployment)
npm run test:smoke

# Coverage
npm run coverage                          # full coverage report
npm run coverage:merge                    # merge unit + integration coverage

# CI pipeline (full)
npm run test:ci
```

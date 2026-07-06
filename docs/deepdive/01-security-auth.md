# Deepdive: Security & Auth Foundation

**Last Updated:** 2026-07-06
**Status:** Final Draft
**Applies To:** All endpoints & middleware

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication Flow](#2-authentication-flow)
3. [JWT Implementation](#3-jwt-implementation)
4. [Password Security](#4-password-security)
5. [Authorization (RBAC)](#5-authorization-rbac)
6. [Rate Limiting](#6-rate-limiting)
7. [Input Validation](#7-input-validation)
8. [CORS & Security Headers](#8-cors--security-headers)
9. [Error Handling Security](#9-error-handling-security)
10. [Session Management](#10-session-management)
11. [Secure Development Practices](#11-secure-development-practices)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Architecture Overview

```
Client Request
    │
    ▼
┌─────────────────────────────────────┐
│        Cloudflare Worker            │
│                                     │
│  1. Rate Limiter (KV-based)         │
│  2. CORS Handler                    │
│  3. Security Headers                │
│  4. JWT Middleware (if protected)    │
│  5. RBAC Middleware (if scoped)      │
│  6. Validation Middleware           │
│  7. Route Handler                   │
│  8. Error Handler                   │
└─────────────────────────────────────┘
    │
    ▼
Response (JSON + Headers)
```

### Middleware Order (Execution Order)
Middleware dieksekusi berurutan. Urutan matters untuk security:

1. **Rate Limiter** — block sebelum processing apa pun
2. **CORS** — handle preflight
3. **Security Headers** — set CSP, HSTS, etc.
4. **JWT Verify** — authenticate (skip untuk public routes)
5. **RBAC** — authorize (skip untuk public routes)
6. **Validation** — validate request body/params
7. **Route Handler** — business logic
8. **Error Handler** — catch all errors, format response

---

## 2. Authentication Flow

### 2.1 Register Flow (Self-register Ustadz)

```
POST /api/auth/register
{
    "email": "ustadz@pesantren.id",
    "password": "Str0ng!Pass123",
    "nama_lengkap": "Ustadz Asep"
}
```

**Server Steps:**
1. Validate input (email format, password strength, nama_lengkap required)
2. Check email uniqueness (case-insensitive)
3. Hash password dengan bcrypt (cost=12)
4. Create user record dengan role=`ustadz`, status=`pending`
5. Log audit: `action: "user.register", entity_type: "users", entity_id: user.id`
6. Return 201: `{ message: "Akun berhasil dibuat, menunggu persetujuan admin" }`

**Important:** Jangan send email di response. Admin akan notified via dashboard.

### 2.2 Login Flow

```
POST /api/auth/login
{
    "email": "ustadz@pesantren.id",
    "password": "Str0ng!Pass123"
}
```

**Server Steps:**
1. Validate input
2. Find user by email (case-insensitive)
3. If not found: return generic error (jangan bilang "email not found")
4. Check password with bcrypt
5. If wrong: increment failed_attempts, return generic error
6. Check user status:
   - `pending`: return `{ code: "ACCOUNT_PENDING", message: "Menunggu persetujuan admin" }`
   - `suspended`: return `{ code: "ACCOUNT_SUSPENDED", message: "Akun dinonaktifkan. Hubungi admin" }`
   - `approved`: continue
7. Generate access token (15min) + refresh token (7d)
8. Update `last_login`, reset `failed_attempts`
9. Log audit: `action: "user.login"`
10. Return tokens + user info (tanpa password_hash)

### 2.3 Refresh Token Flow

```
POST /api/auth/refresh
Cookie: refresh_token=<token>
```

**Server Steps:**
1. Validate refresh token signature & expiry
2. Check if token has been used before (rotation)
3. If already used → suspect token theft → revoke all user sessions
4. If valid: generate new access + refresh token pair
5. Update refresh token in store (invalidate old one)
6. Return new tokens

### 2.4 Logout Flow

```
POST /api/auth/logout
Cookie: refresh_token=<token>
Authorization: Bearer <access_token>
```

**Server Steps:**
1. Invalidate refresh token
2. Add access token to blacklist (until its original expiry)
3. Log audit: `action: "user.logout"`

---

## 3. JWT Implementation

### 3.1 Token Structure

**Access Token** (15 minutes)
```json
{
    "sub": "user-uuid",
    "email": "ustadz@pesantren.id",
    "role": "ustadz",
    "kelas_ids": ["kelas-1", "kelas-2"],
    "iat": 1712345678,
    "exp": 1712346578,
    "jti": "unique-token-id"
}
```

**Refresh Token** (7 days)
```json
{
    "sub": "user-uuid",
    "type": "refresh",
    "iat": 1712345678,
    "exp": 1712950478,
    "jti": "unique-refresh-id"
}
```

### 3.2 Signing Algorithm

```typescript
// Use HS256 (HMAC with SHA-256) for single Worker deployment
// Use RS256 (RSA with SHA-256) for multi-service deployment

// HS256 Implementation (recommended for this project)
import { sign, verify } from 'hono/jwt'

const ACCESS_SECRET = c.env.JWT_ACCESS_SECRET  // Worker env variable
const REFRESH_SECRET = c.env.JWT_REFRESH_SECRET // Worker env variable

async function generateTokens(user: User): Promise<TokenPair> {
    const accessPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        kelas_ids: user.kelas_ids,
        exp: Math.floor(Date.now() / 1000) + 900,   // 15 menit
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID()
    }

    const refreshPayload = {
        sub: user.id,
        type: 'refresh',
        exp: Math.floor(Date.now() / 1000) + 604800, // 7 hari
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID()
    }

    return {
        access_token: await sign(accessPayload, ACCESS_SECRET),
        refresh_token: await sign(refreshPayload, REFRESH_SECRET)
    }
}
```

### 3.3 Token Storage

**Critical Decision: Use httpOnly Cookies instead of localStorage**

```typescript
// Set cookies in response
c.header('Set-Cookie', [
    `access_token=${access_token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
    `refresh_token=${refresh_token}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=604800`
])
```

**Rationale:**
- `HttpOnly`: JavaScript can't access → XSS-proof
- `Secure`: Only sent over HTTPS
- `SameSite=Strict`: CSRF protection
- `Path=/api/auth`: Refresh token only sent to auth endpoints
- `Path=/`: Access token sent to all endpoints

**Fallback for SPA:** Jika cookies tidak feasible (SPA needs JS), gunakan:
- Access token di `Authorization: Bearer` header (in-memory only, not localStorage)
- Refresh token di httpOnly cookie

### 3.4 Token Validation Middleware

```typescript
// Middleware pattern
async function authMiddleware(c: Context, next: Next) {
    const token = extractToken(c.req) // from cookie or Authorization header
    
    if (!token) {
        return c.json({ error: 'Unauthorized', code: 'NO_TOKEN' }, 401)
    }

    try {
        const payload = await verify(token, c.env.JWT_ACCESS_SECRET)

        // Check if token is blacklisted
        const isBlacklisted = await c.env.KV.get(`blacklist:${payload.jti}`)
        if (isBlacklisted) {
            return c.json({ error: 'Token revoked', code: 'TOKEN_REVOKED' }, 401)
        }

        // Set user info in context
        c.set('user', payload)
        await next()
    } catch (err) {
        if (err.name === 'JwtTokenExpired') {
            return c.json({ error: 'Token expired', code: 'TOKEN_EXPIRED' }, 401)
        }
        return c.json({ error: 'Invalid token', code: 'INVALID_TOKEN' }, 401)
    }
}
```

### 3.5 Token Blacklisting

Gunakan D1 atau KV untuk blacklist:

```sql
-- D1 Table for token blacklist
CREATE TABLE token_blacklist (
    jti TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cleanup expired entries periodically
-- Or use KV with TTL
```

**Alternative: Use Cloudflare KV dengan TTL (auto-expire)**

```typescript
// Blacklist token saat logout
await c.env.KV.put(
    `blacklist:${payload.jti}`,
    'true',
    { expirationTtl: remainingSeconds } // auto-expire
)
```

---

## 4. Password Security

### 4.1 Hashing Strategy

```typescript
import { hash, compare } from 'bcryptjs'  // or use Web Crypto API

const BCRYPT_COST = 12  // ~250ms on modern hardware

async function hashPassword(password: string): Promise<string> {
    return hash(password, BCRYPT_COST)
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return compare(password, hash)
}
```

**Kenapa cost=12?**
- cost=10: ~80ms (minimal recommended)
- cost=12: ~250ms (balance security/performance)
- cost=14: ~1s (overkill for this use case)

### 4.2 Password Policy

```typescript
const PASSWORD_POLICY = {
    minLength: 8,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecialChar: true,
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutes
    passwordHistory: 5  // prevent reuse of last 5 passwords
}

function validatePassword(password: string): ValidationResult {
    const errors: string[] = []

    if (password.length < PASSWORD_POLICY.minLength) {
        errors.push('Minimal 8 karakter')
    }
    if (password.length > PASSWORD_POLICY.maxLength) {
        errors.push('Maksimal 128 karakter')
    }
    if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push('Butuh huruf kapital')
    }
    if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
        errors.push('Butuh huruf kecil')
    }
    if (PASSWORD_POLICY.requireNumber && !/\d/.test(password)) {
        errors.push('Butuh angka')
    }
    if (PASSWORD_POLICY.requireSpecialChar && !/[^A-Za-z0-9]/.test(password)) {
        errors.push('Butuh karakter spesial')
    }

    return {
        valid: errors.length === 0,
        errors
    }
}
```

### 4.3 Brute Force Protection

```typescript
// Track login attempts per email/IP
async function checkBruteForce(c: Context, email: string, ip: string) {
    const key = `login_attempts:${email}:${ip}`
    const attempts = await c.env.KV.get(key)
    const count = parseInt(attempts || '0')

    if (count >= 5) {
        const ttl = await c.env.KV.get(`login_lockout:${email}:${ip}`)
        if (ttl) {
            return { blocked: true, remainingMinutes: Math.ceil(parseInt(ttl) / 60) }
        }
    }

    return { blocked: false }
}

async function incrementLoginAttempts(c: Context, email: string, ip: string) {
    const key = `login_attempts:${email}:${ip}`
    const lockoutKey = `login_lockout:${email}:${ip}`

    const current = parseInt(await c.env.KV.get(key) || '0')
    const newCount = current + 1

    if (newCount >= 5) {
        // Lockout for 15 minutes
        await c.env.KV.put(lockoutKey, 'true', { expirationTtl: 900 })
        await c.env.KV.put(key, '0', { expirationTtl: 900 })
    } else {
        await c.env.KV.put(key, String(newCount), { expirationTtl: 900 })
    }
}
```

---

## 5. Authorization (RBAC)

### 5.1 Role Definitions

```typescript
enum Role {
    ADMIN = 'admin',
    USTADZ = 'ustadz'
}

enum UserStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    SUSPENDED = 'suspended'
}

interface UserPermissions {
    canManageUsers: boolean
    canManageKelas: boolean
    canManageKategori: boolean
    canManageAllSantri: boolean
    canManageAssignedSantri: boolean
    canViewDashboard: boolean
}

const ROLE_PERMISSIONS: Record<Role, UserPermissions> = {
    [Role.ADMIN]: {
        canManageUsers: true,
        canManageKelas: true,
        canManageKategori: true,
        canManageAllSantri: true,
        canManageAssignedSantri: true,
        canViewDashboard: true
    },
    [Role.USTADZ]: {
        canManageUsers: false,
        canManageKelas: false,
        canManageKategori: false,
        canManageAllSantri: false,
        canManageAssignedSantri: true,
        canViewDashboard: false
    }
}
```

### 5.2 RBAC Middleware

```typescript
// Generic RBAC middleware
function requirePermission(permission: keyof UserPermissions) {
    return async (c: Context, next: Next) => {
        const user = c.get('user')
        const permissions = ROLE_PERMISSIONS[user.role as Role]

        if (!permissions[permission]) {
            return c.json({
                error: 'Forbidden',
                code: 'INSUFFICIENT_PERMISSIONS',
                message: 'Anda tidak memiliki akses ke resource ini'
            }, 403)
        }

        await next()
    }
}

// Specific RBAC middleware
function requireScopedAccess() {
    return async (c: Context, next: Next) => {
        const user = c.get('user')
        const kelasId = c.req.param('kelas_id') || c.req.query('kelas_id')
        const santriId = c.req.param('santri_id')

        // Admin bypass
        if (user.role === 'admin') {
            return await next()
        }

        // Ustadz: check if they have access to this kelas
        if (kelasId && !user.kelas_ids.includes(kelasId)) {
            return c.json({
                error: 'Forbidden',
                code: 'KELAS_NOT_ASSIGNED',
                message: 'Anda tidak mengajar kelas ini'
            }, 403)
        }

        // If accessing santri, check santri's kelas
        if (santriId) {
            const santri = await getSantriById(santriId)
            if (santri && !user.kelas_ids.includes(santri.kelas_id)) {
                return c.json({
                    error: 'Forbidden',
                    code: 'SANTRI_NOT_IN_ASSIGNED_KELAS',
                    message: 'Anda tidak memiliki akses ke data santri ini'
                }, 403)
            }
        }

        await next()
    }
}

// Route-level permission check
function requireStatus(status: UserStatus) {
    return async (c: Context, next: Next) => {
        const user = c.get('user')
        if (user.status !== status) {
            return c.json({
                error: 'Forbidden',
                code: 'ACCOUNT_NOT_ACTIVE',
                message: `Akun dalam status ${user.status}`
            }, 403)
        }
        await next()
    }
}
```

### 5.3 Approve Flow

```typescript
// Admin approve ustadz
async function approveUstadz(c: Context) {
    const { userId, kelas_ids } = await c.req.json()
    const admin = c.get('user')

    // Validate user exists and is pending
    const user = await db.getUser(userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    if (user.status !== 'pending') {
        return c.json({ error: 'User tidak dalam status pending' }, 400)
    }

    // Validate kelas_ids exist
    const validKelas = await db.getKelasByIds(kelas_ids)
    if (validKelas.length !== kelas_ids.length) {
        return c.json({ error: 'Beberapa kelas tidak ditemukan' }, 400)
    }

    // Update user status to approved
    await db.updateUser(userId, { status: 'approved' })

    // Assign kelas
    await db.assignKelasToUstadz(userId, kelas_ids)

    // Audit log
    await db.createAuditLog({
        user_id: admin.sub,
        action: 'user.approve',
        entity_type: 'users',
        entity_id: userId,
        new_value: JSON.stringify({ status: 'approved', kelas_ids })
    })

    return c.json({ message: 'Ustadz berhasil diaktifkan' })
}
```

---

## 6. Rate Limiting

### 6.1 Strategy

Gunakan **Cloudflare KV** untuk rate limiting store. KV is ideal karena:
- Global low-latency reads
- Built-in TTL support
- Scales horizontally

### 6.2 Implementation

```typescript
interface RateLimitConfig {
    window: number  // waktu dalam detik
    max: number     // max requests per window
    identifier: string  // 'ip' | 'user' | 'endpoint'
}

const RATE_LIMIT_CONFIGS = {
    // Auth endpoints: ketat
    'auth:login': { window: 60, max: 10, identifier: 'ip' },
    'auth:register': { window: 3600, max: 3, identifier: 'ip' },
    'auth:refresh': { window: 60, max: 20, identifier: 'user' },

    // General API
    'api:general': { window: 60, max: 100, identifier: 'user' },

    // Write operations
    'api:write': { window: 60, max: 30, identifier: 'user' },

    // Sync operations
    'api:sync': { window: 60, max: 20, identifier: 'user' },

    // Dashboard
    'api:dashboard': { window: 60, max: 20, identifier: 'user' }
}

async function rateLimitMiddleware(c: Context, next: Next) {
    const path = c.req.path
    const method = c.req.method
    const key = getRateLimitKey(c, path)
    const config = getRateLimitConfig(path)

    if (!config) {
        // No rate limit for this endpoint
        return await next()
    }

    const identifier = getIdentifier(c, config.identifier)
    const rateLimitKey = `ratelimit:${key}:${identifier}`
    const windowStart = Math.floor(Date.now() / 1000 / config.window) * config.window

    const currentKey = `${rateLimitKey}:${windowStart}`
    const value = await c.env.KV.get(currentKey)
    const count = parseInt(value || '0')

    if (count >= config.max) {
        const retryAfter = config.window - (Date.now() / 1000 - windowStart)

        c.header('Retry-After', String(Math.ceil(retryAfter)))
        return c.json({
            error: 'Too Many Requests',
            code: 'RATE_LIMITED',
            message: 'Terlalu banyak permintaan. Coba lagi nanti',
            retryAfter: Math.ceil(retryAfter)
        }, 429)
    }

    // Increment counter
    await c.env.KV.put(currentKey, String(count + 1), {
        expirationTtl: config.window
    })

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(config.max))
    c.header('X-RateLimit-Remaining', String(config.max - count - 1))
    c.header('X-RateLimit-Reset', String(windowStart + config.window))

    await next()
}
```

### 6.3 Rate Limit Headers

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1712346600
```

### 6.4 IP Detection

```typescript
function getClientIP(c: Context): string {
    // Cloudflare Workers: use CF-Connecting-IP header
    const cfIP = c.req.header('CF-Connecting-IP')
    if (cfIP) return cfIP

    // Fallback headers
    const xForwardedFor = c.req.header('X-Forwarded-For')
    if (xForwardedFor) return xForwardedFor.split(',')[0].trim()

    const xRealIP = c.req.header('X-Real-IP')
    if (xRealIP) return xRealIP

    // Last resort
    return 'unknown'
}
```

---

## 7. Input Validation

### 7.1 Validation Library

Gunakan **Zod** untuk semua validation:

```typescript
import { z } from 'zod'

// Reusable schemas
const uuidSchema = z.string().uuid()
const emailSchema = z.string().email().max(255)
const passwordSchema = z.string()
    .min(8, 'Password minimal 8 karakter')
    .max(128, 'Password maksimal 128 karakter')
    .regex(/[A-Z]/, 'Butuh huruf kapital')
    .regex(/[a-z]/, 'Butuh huruf kecil')
    .regex(/\d/, 'Butuh angka')
    .regex(/[^A-Za-z0-9]/, 'Butuh karakter spesial')

// Endpoint schemas
const registerSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    nama_lengkap: z.string().min(2).max(100)
})

const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password harus diisi')
})

const createSantriSchema = z.object({
    nama_lengkap: z.string().min(2).max(200),
    jenis_kelamin: z.enum(['L', 'P']),
    kelas_id: uuidSchema.optional(),
    angkatan: z.string().max(10).optional(),
    tanggal_masuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    foto_url: z.string().url().optional()
})

// Validation middleware
function validate(schema: z.ZodSchema) {
    return async (c: Context, next: Next) => {
        let data: unknown

        if (c.req.method === 'GET' || c.req.method === 'DELETE') {
            data = { ...c.req.query(), ...c.req.param() }
        } else {
            try {
                data = await c.req.json()
            } catch {
                return c.json({
                    error: 'Bad Request',
                    code: 'INVALID_JSON',
                    message: 'Request body harus valid JSON'
                }, 400)
            }
        }

        const result = schema.safeParse(data)

        if (!result.success) {
            const errors = result.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message
            }))

            return c.json({
                error: 'Validation Error',
                code: 'VALIDATION_ERROR',
                message: 'Data yang dikirim tidak valid',
                errors
            }, 400)
        }

        // Set validated data in context
        c.set('validated', result.data)
        await next()
    }
}
```

### 7.2 Sanitization

```typescript
// Strip HTML tags dari text input
function sanitizeText(input: string): string {
    return input
        .replace(/<[^>]*>/g, '')     // Remove HTML tags
        .replace(/[<>]/g, '')        // Remove angle brackets
        .trim()
}

// Recursive sanitize object
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            sanitized[key] = sanitizeText(value)
        } else if (Array.isArray(value)) {
            sanitized[key] = value.map(v =>
                typeof v === 'string' ? sanitizeText(v) : v
            )
        } else if (value && typeof value === 'object') {
            sanitized[key] = sanitizeObject(value as Record<string, unknown>)
        } else {
            sanitized[key] = value
        }
    }
    return sanitized
}
```

---

## 8. CORS & Security Headers

### 8.1 CORS Configuration

```typescript
const CORS_CONFIG = {
    allowedOrigins: [
        'https://santrivora.com',             // Production
        'https://staging.santrivora.com',      // Staging
        'http://localhost:5173',               // Vite dev
        'http://localhost:8787'                // Wrangler dev
    ],
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400  // 24 hours
}

function corsMiddleware(c: Context, next: Next) {
    const origin = c.req.header('Origin')

    if (origin && CORS_CONFIG.allowedOrigins.includes(origin)) {
        c.header('Access-Control-Allow-Origin', origin)
        c.header('Access-Control-Allow-Methods', CORS_CONFIG.allowedMethods.join(', '))
        c.header('Access-Control-Allow-Headers', CORS_CONFIG.allowedHeaders.join(', '))
        c.header('Access-Control-Expose-Headers', CORS_CONFIG.exposeHeaders.join(', '))
        c.header('Access-Control-Max-Age', String(CORS_CONFIG.maxAge))

        // Credentials for cookies
        c.header('Access-Control-Allow-Credentials', 'true')
    }

    // Handle preflight
    if (c.req.method === 'OPTIONS') {
        return c.body(null, 204)
    }

    return next()
}
```

### 8.2 Security Headers

```typescript
function securityHeadersMiddleware(c: Context, next: Next) {
    // HSTS — Force HTTPS
    c.header('Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload')

    // CSP — Control what resources can be loaded
    c.header('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +  // For SPA
        "style-src 'self' 'unsafe-inline'; " +                  // For Tailwind
        "img-src 'self' data: https:; " +
        "connect-src 'self' https://api.santrivora.com; " +
        "frame-ancestors 'none'; " +
        "form-action 'self'")

    // XSS Protection
    c.header('X-XSS-Protection', '1; mode=block')

    // Prevent MIME type sniffing
    c.header('X-Content-Type-Options', 'nosniff')

    // Referrer Policy
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')

    // Frame Options
    c.header('X-Frame-Options', 'DENY')

    // Feature Policy / Permissions Policy
    c.header('Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=()')

    // Cache Control for API responses
    if (c.req.method === 'GET') {
        c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    } else {
        c.header('Cache-Control', 'no-store')
    }

    // Disable auto-detection of phone numbers/emails
    c.header('X-Download-Options', 'noopen')

    return next()
}
```

---

## 9. Error Handling Security

### 9.1 Security-aware Error Handler

```typescript
async function errorHandlerMiddleware(c: Context, next: Next) {
    try {
        await next()
    } catch (err) {
        // Log error internally (never expose to client)
        console.error('Internal Error:', {
            error: err instanceof Error ? err.message : 'Unknown error',
            stack: err instanceof Error ? err.stack : undefined,
            path: c.req.path,
            method: c.req.method,
            userId: c.get('user')?.sub || 'anonymous',
            requestId: c.req.header('CF-Ray') || crypto.randomUUID()
        })

        // Never expose internal error details
        const isProduction = c.env.ENVIRONMENT === 'production'
        const clientError = {
            error: 'Internal Server Error',
            code: 'INTERNAL_ERROR',
            message: isProduction
                ? 'Terjadi kesalahan internal. Silakan coba lagi.'
                : err instanceof Error ? err.message : 'Unknown error',
            requestId: c.req.header('CF-Ray') || null
        }

        return c.json(clientError, 500)
    }
}
```

### 9.2 Error Response Format

```typescript
// Standard error format untuk semua error responses
interface ApiError {
    error: string              // Human-readable error title
    code: string              // Machine-readable error code
    message: string           // User-friendly message
    requestId?: string        // For debugging
    errors?: Array<{          // For validation errors only
        field: string
        message: string
    }>
    retryAfter?: number       // For rate limiting
}

// Error codes enum
enum ErrorCode {
    // Auth (4xx)
    NO_TOKEN = 'NO_TOKEN',
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    TOKEN_REVOKED = 'TOKEN_REVOKED',
    INVALID_TOKEN = 'INVALID_TOKEN',
    INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
    ACCOUNT_PENDING = 'ACCOUNT_PENDING',
    ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
    INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
    KELAS_NOT_ASSIGNED = 'KELAS_NOT_ASSIGNED',

    // Validation (4xx)
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    INVALID_JSON = 'INVALID_JSON',

    // Business Logic (4xx)
    DUPLICATE_EMAIL = 'DUPLICATE_EMAIL',
    SANTRI_NOT_FOUND = 'SANTRI_NOT_FOUND',
    KELAS_NOT_FOUND = 'KELAS_NOT_FOUND',

    // Rate Limiting (429)
    RATE_LIMITED = 'RATE_LIMITED',

    // Server (5xx)
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR'
}
```

### 9.3 Security Checklist untuk Error Handling

- [ ] Never expose stack traces in production
- [ ] Never expose internal IDs (use UUIDs)
- [ ] Never reveal which field is invalid in auth errors
- [ ] Log all errors internally with correlation ID
- [ ] Set `requestId` in response for tracing
- [ ] Sanitize error messages (remove SQL, paths, etc.)
- [ ] Consistent error format across all endpoints
- [ ] Return 404 for both "not found" dan "forbidden" (prevent info leak)

---

## 10. Session Management

### 10.1 Session Store

```typescript
// Use D1 for session persistence
// More reliable than KV for critical auth data

interface Session {
    id: string
    user_id: string
    refresh_token_jti: string
    device_info: string
    ip_address: string
    user_agent: string
    last_activity: string
    expires_at: string
    is_revoked: boolean
    created_at: string
}

-- D1 Table
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

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_jti ON sessions(refresh_token_jti);
```

### 10.2 Session Management Functions

```typescript
async function createSession(userId: string, refreshJti: string, c: Context) {
    const session = {
        id: crypto.randomUUID(),
        user_id: userId,
        refresh_token_jti: refreshJti,
        device_info: c.req.header('User-Agent') || 'Unknown',
        ip_address: getClientIP(c),
        user_agent: c.req.header('User-Agent') || '',
        last_activity: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        is_revoked: false
    }

    await db.insert('sessions', session)
    return session
}

async function revokeSession(jti: string) {
    await db.execute(
        'UPDATE sessions SET is_revoked = 1 WHERE refresh_token_jti = ?',
        [jti]
    )
}

async function revokeAllUserSessions(userId: string) {
    await db.execute(
        'UPDATE sessions SET is_revoked = 1 WHERE user_id = ? AND is_revoked = 0',
        [userId]
    )
}

async function cleanupExpiredSessions() {
    await db.execute(
        'DELETE FROM sessions WHERE expires_at < datetime("now") OR is_revoked = 1'
    )
}
```

### 10.3 Session Invalidation Scenarios

| Scenario | Action |
|---|---|
| User logout | Revoke specific session |
| Password change | Revoke all user sessions except current |
| Account suspended | Revoke all user sessions |
| Token rotation (refresh used again) | Revoke all user sessions (theft detected) |
| Admin force logout | Revoke specific user session |

---

## 11. Secure Development Practices

### 11.1 Environment Variables

```typescript
// Environment variables yang perlu diset
// wrangler.toml or Cloudflare Dashboard

interface Env {
    // Required
    JWT_ACCESS_SECRET: string        // Min 32 chars, random
    JWT_REFRESH_SECRET: string       // Min 32 chars, random, different from access
    ENVIRONMENT: 'development' | 'staging' | 'production'

    // Bindings
    DB: D1Database
    KV: KVNamespace
    R2: R2Bucket

    // Optional
    SENTRY_DSN?: string
    LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error'
    ADMIN_EMAIL?: string
    PESANTREN_NAME?: string
}

// Validate required env vars on startup
function validateEnv(env: Env): void {
    const required = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENVIRONMENT']
    const missing = required.filter(key => !env[key])

    if (missing.length > 0) {
        throw new Error(`Missing required env vars: ${missing.join(', ')}`)
    }

    if (env.JWT_ACCESS_SECRET.length < 32) {
        throw new Error('JWT_ACCESS_SECRET minimal 32 karakter')
    }

    if (env.JWT_REFRESH_SECRET.length < 32) {
        throw new Error('JWT_REFRESH_SECRET minimal 32 karakter')
    }

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
        throw new Error('JWT_ACCESS_SECRET dan JWT_REFRESH_SECRET harus berbeda')
    }
}
```

### 11.2 Secret Generation

```bash
# Generate strong secrets
openssl rand -base64 48   # 48 bytes → 64 chars base64
# atau
node -e "console.log(crypto.randomBytes(48).toString('base64'))"
```

### 11.3 Security Audit Checklist

**Pre-deployment:**
- [ ] All secrets stored in Workers Secrets (not in code)
- [ ] JWT signing keys are different for access and refresh tokens
- [ ] Rate limiting configured for all endpoints
- [ ] CORS origins whitelist (no wildcard in production)
- [ ] CSP headers configured
- [ ] Error handling doesn't leak internals
- [ ] Input validation for all endpoints
- [ ] SQL injection prevention via parameterized queries
- [ ] XSS prevention via input sanitization + CSP

**Post-deployment:**
- [ ] Security headers verified (use securityheaders.com)
- [ ] Rate limiting working as expected
- [ ] Error monitoring set up (Sentry)
- [ ] Audit logging functional
- [ ] Brute force protection working
- [ ] Token rotation working

---

## 12. Implementation Checklist

### Phase 1: Foundation
- [ ] Set up Cloudflare Workers project
- [ ] Create D1 tables (users, sessions, token_blacklist)
- [ ] Implement password hashing (bcrypt cost=12)
- [ ] Implement JWT generation + verification
- [ ] Implement httpOnly cookie handling
- [ ] Implement auth middleware

### Phase 2: Auth Endpoints
- [ ] POST /api/auth/register
- [ ] POST /api/auth/login
- [ ] POST /api/auth/refresh
- [ ] POST /api/auth/logout
- [ ] GET /api/auth/me

### Phase 3: Security Middleware
- [ ] Rate limiter (KV-based)
- [ ] CORS middleware
- [ ] Security headers middleware
- [ ] Error handler middleware
- [ ] Input validation middleware (Zod)

### Phase 4: Authorization
- [ ] RBAC middleware by role
- [ ] Scoped access middleware by kelas
- [ ] Admin approve/suspend flow
- [ ] Audit logging for auth events

### Phase 5: Security Hardening
- [ ] Brute force protection
- [ ] Token rotation
- [ ] Session management
- [ ] Password policy enforcement
- [ ] Security headers verification
- [ ] Penetration testing

---

**Related Documents:**
- [02-database-schema.md](./02-database-schema.md)
- [04-testing-strategy.md](./04-testing-strategy.md)
- [05-error-handling-logging.md](./05-error-handling-logging.md)

# Deepdive: Error Handling & Logging

**Last Updated:** 2026-07-06
**Status:** Final Draft
**Applies To:** All endpoints, middleware, client-side code, infrastructure

---

## Table of Contents

1. [Error Philosophy](#1-error-philosophy)
2. [Error Classification](#2-error-classification)
3. [Error Response Format](#3-error-response-format)
4. [Global Error Handler](#4-global-error-handler)
5. [Structured Logging](#5-structured-logging)
6. [Error Tracking with Sentry](#6-error-tracking-with-sentry)
7. [Logpush Configuration](#7-logpush-configuration)
8. [Alerting Rules](#8-alerting-rules)
9. [Debugging in Production](#9-debugging-in-production)
10. [Error Recovery Strategies](#10-error-recovery-strategies)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. Error Philosophy

### Core Principles

1. **Fail Fast** — Detect and reject invalid state as early as possible. Validate inputs at the boundary, check auth at the gate, catch constraint violations before they corrupt data.

2. **Never Expose Internals** — In production, stack traces, SQL queries, file paths, and internal IDs never reach the client. Every error response is sanitised.

3. **Always Recoverable** — Every error has a recovery path. Validation errors tell the user what to fix. Auth errors hint at the next action. Network errors trigger retry. Only unrecoverable errors crash.

4. **Audit Everything** — All errors are logged internally with enough context to debug. Correlation IDs tie together logs, Sentry events, and user reports.

### Error Handling Pyramid

```
Layer                    Responsibility
──────────────────────────────────────────────────
HTTP Boundary            Sanitise + format response
Middleware Layer         Catch + log + classify
Business Logic           Throw typed AppError
Data Access              Wrap DB errors + retry
Infrastructure           Monitor + alert
```

### Security-First Rules

```typescript
// NEVER do this:
return c.json({ error: 'User not found with email: user@example.com' }, 404)

// ALWAYS do this:
return c.json({
    error: 'Invalid credentials',
    code: 'INVALID_CREDENTIALS',
    message: 'Email atau password salah'
}, 401)
```

| Rule | Rationale |
|---|---|
| Never reveal which field is wrong in login | Prevents email enumeration attacks |
| Never expose stack traces in production | Leaks code structure and paths |
| Never return `null` for missing data | Use `{ data: null }` consistently |
| Never trust client error messages | Always validate before logging |
| Always include request ID | Enables cross-referencing logs to user reports |

---

## 2. Error Classification

### 2.1 Error Code Taxonomy

```typescript
// src/types/errors.ts
export const ErrorCode = {
    // ── Auth Errors (401-403) ──
    NO_TOKEN: 'NO_TOKEN',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_REVOKED: 'TOKEN_REVOKED',
    INVALID_TOKEN: 'INVALID_TOKEN',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    ACCOUNT_PENDING: 'ACCOUNT_PENDING',
    ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    KELAS_NOT_ASSIGNED: 'KELAS_NOT_ASSIGNED',

    // ── Validation Errors (400) ──
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_JSON: 'INVALID_JSON',
    INVALID_UUID: 'INVALID_UUID',
    MISSING_FIELD: 'MISSING_FIELD',

    // ── Business Logic Errors (400-409) ──
    DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
    SANTRI_NOT_FOUND: 'SANTRI_NOT_FOUND',
    SANTRI_NOT_ACTIVE: 'SANTRI_NOT_ACTIVE',
    KELAS_NOT_FOUND: 'KELAS_NOT_FOUND',
    KATEGORI_NOT_FOUND: 'KATEGORI_NOT_FOUND',
    DUPLICATE_SANTRI: 'DUPLICATE_SANTRI',
    SANTRI_KELUAR: 'SANTRI_KELUAR',
    CONFLICT_DETECTED: 'CONFLICT_DETECTED',

    // ── Sync Errors (409-412) ──
    SYNC_CONFLICT: 'SYNC_CONFLICT',
    VERSION_MISMATCH: 'VERSION_MISMATCH',
    DUPLICATE_CREATE: 'DUPLICATE_CREATE',
    SYNC_FAILED: 'SYNC_FAILED',

    // ── Rate Limiting (429) ──
    RATE_LIMITED: 'RATE_LIMITED',

    // ── System Errors (500) ──
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
    R2_ERROR: 'R2_ERROR',
    KV_ERROR: 'KV_ERROR'
} as const

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode]
```

### 2.2 Error Classification Map

```typescript
// Categorise errors for alerting and monitoring
export enum ErrorSeverity {
    CRITICAL = 'critical',    // System down, data corruption
    ERROR = 'error',          // Failed request, failed sync
    WARNING = 'warning',      // Rate limit approaching, retries
    INFO = 'info'             // Validation errors, auth failures
}

export const ERROR_CLASSIFICATION: Record<ErrorCode, {
    severity: ErrorSeverity
    httpStatus: number
    logLevel: 'error' | 'warn' | 'info'
    alertable: boolean
}> = {
    // Auth
    [ErrorCode.NO_TOKEN]:               { severity: ErrorSeverity.INFO, httpStatus: 401, logLevel: 'info', alertable: false },
    [ErrorCode.TOKEN_EXPIRED]:          { severity: ErrorSeverity.INFO, httpStatus: 401, logLevel: 'info', alertable: false },
    [ErrorCode.TOKEN_REVOKED]:          { severity: ErrorSeverity.INFO, httpStatus: 401, logLevel: 'info', alertable: false },
    [ErrorCode.INVALID_TOKEN]:          { severity: ErrorSeverity.WARNING, httpStatus: 401, logLevel: 'warn', alertable: false },
    [ErrorCode.INVALID_CREDENTIALS]:    { severity: ErrorSeverity.INFO, httpStatus: 401, logLevel: 'info', alertable: false },
    [ErrorCode.ACCOUNT_SUSPENDED]:      { severity: ErrorSeverity.WARNING, httpStatus: 403, logLevel: 'warn', alertable: true },
    [ErrorCode.INSUFFICIENT_PERMISSIONS]: { severity: ErrorSeverity.WARNING, httpStatus: 403, logLevel: 'warn', alertable: true },

    // Validation
    [ErrorCode.VALIDATION_ERROR]:       { severity: ErrorSeverity.INFO, httpStatus: 400, logLevel: 'info', alertable: false },
    [ErrorCode.INVALID_JSON]:           { severity: ErrorSeverity.INFO, httpStatus: 400, logLevel: 'info', alertable: false },

    // Business
    [ErrorCode.DUPLICATE_EMAIL]:        { severity: ErrorSeverity.INFO, httpStatus: 409, logLevel: 'info', alertable: false },
    [ErrorCode.SANTRI_NOT_FOUND]:       { severity: ErrorSeverity.INFO, httpStatus: 404, logLevel: 'info', alertable: false },
    [ErrorCode.SANTRI_NOT_ACTIVE]:      { severity: ErrorSeverity.WARNING, httpStatus: 400, logLevel: 'warn', alertable: false },

    // Sync
    [ErrorCode.SYNC_CONFLICT]:          { severity: ErrorSeverity.WARNING, httpStatus: 409, logLevel: 'warn', alertable: true },
    [ErrorCode.VERSION_MISMATCH]:       { severity: ErrorSeverity.WARNING, httpStatus: 409, logLevel: 'warn', alertable: true },
    [ErrorCode.SYNC_FAILED]:            { severity: ErrorSeverity.ERROR, httpStatus: 500, logLevel: 'error', alertable: true },

    // Rate limiting
    [ErrorCode.RATE_LIMITED]:           { severity: ErrorSeverity.WARNING, httpStatus: 429, logLevel: 'warn', alertable: true },

    // System
    [ErrorCode.INTERNAL_ERROR]:         { severity: ErrorSeverity.CRITICAL, httpStatus: 500, logLevel: 'error', alertable: true },
    [ErrorCode.DATABASE_ERROR]:         { severity: ErrorSeverity.CRITICAL, httpStatus: 500, logLevel: 'error', alertable: true },
    [ErrorCode.EXTERNAL_SERVICE_ERROR]: { severity: ErrorSeverity.ERROR, httpStatus: 502, logLevel: 'error', alertable: true },
    [ErrorCode.R2_ERROR]:               { severity: ErrorSeverity.ERROR, httpStatus: 502, logLevel: 'error', alertable: true }
}
```

### 2.3 AppError Class

```typescript
// src/utils/app-error.ts
export class AppError extends Error {
    public readonly code: ErrorCode
    public readonly httpStatus: number
    public readonly severity: ErrorSeverity
    public readonly details?: Record<string, unknown>
    public readonly isOperational: boolean  // false = programming bug

    constructor(
        code: ErrorCode,
        message: string,
        options?: {
            httpStatus?: number
            details?: Record<string, unknown>
            cause?: Error
            isOperational?: boolean
        }
    ) {
        super(message)
        this.name = 'AppError'
        this.code = code
        this.httpStatus = options?.httpStatus ?? ERROR_CLASSIFICATION[code]?.httpStatus ?? 500
        this.severity = ERROR_CLASSIFICATION[code]?.severity ?? ErrorSeverity.ERROR
        this.details = options?.details
        this.isOperational = options?.isOperational ?? true
        this.cause = options?.cause

        // Capture stack trace, skipping constructor
        Error.captureStackTrace(this, this.constructor)
    }

    toJSON(): Record<string, unknown> {
        return {
            code: this.code,
            message: this.message,
            httpStatus: this.httpStatus,
            severity: this.severity,
            ...(this.details ? { details: this.details } : {})
        }
    }
}

// Factory helpers for common error types
export function notFound(entity: string, id?: string): AppError {
    return new AppError(
        `${entity.toUpperCase()}_NOT_FOUND` as ErrorCode,
        `${entity} tidak ditemukan${id ? `: ${id}` : ''}`,
        { httpStatus: 404, isOperational: true }
    )
}

export function forbidden(message: string): AppError {
    return new AppError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        message,
        { httpStatus: 403, isOperational: true }
    )
}

export function badRequest(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        { httpStatus: 400, details, isOperational: true }
    )
}

export function databaseError(cause: Error): AppError {
    return new AppError(
        ErrorCode.DATABASE_ERROR,
        'Terjadi kesalahan database',
        { httpStatus: 500, cause, isOperational: false }
    )
}
```

---

## 3. Error Response Format

### 3.1 Standard Error Envelope

Every error response follows this exact shape:

```json
{
    "error": "Validation Error",
    "code": "VALIDATION_ERROR",
    "message": "Data yang dikirim tidak valid",
    "requestId": "cf-ray-abc123",
    "timestamp": "2026-07-06T12:00:00.000Z"
}
```

### 3.2 Error Shape by Type

```typescript
// Base shape — all errors
interface ErrorResponse {
    error: string           // Short human-readable title
    code: string            // Machine-readable error code
    message: string         // User-facing message (Bahasa Indonesia)
    requestId: string       // CF-Ray or generated UUID for tracing
    timestamp: string       // ISO 8601
}

// Validation errors add `errors` array
interface ValidationErrorResponse extends ErrorResponse {
    errors: Array<{
        field: string       // Dot-notation path: "user.email"
        message: string     // User-facing: "Format email tidak valid"
        code?: string       // Optional machine-readable: "TOO_SHORT"
        value?: unknown     // The rejected value (never in production)
    }>
}

// Rate limit errors add retry info
interface RateLimitErrorResponse extends ErrorResponse {
    retryAfter: number      // Seconds until retry
    limit: number           // Max requests per window
    remaining: number       // Requests remaining in window
    reset: number           // Unix timestamp when window resets
}

// Sync conflict errors add conflict data
interface SyncConflictErrorResponse extends ErrorResponse {
    conflict: {
        type: 'version_mismatch' | 'deleted_conflict' | 'duplicate_create'
        serverVersion: number
        serverData?: Record<string, unknown>
        entityType: string
    }
}
```

### 3.3 Response Builder

```typescript
// src/utils/response.ts
export function errorResponse(
    c: Context,
    code: ErrorCode,
    message: string,
    httpStatus: number,
    extra?: Partial<ErrorResponse>
): Response {
    const body: ErrorResponse = {
        error: code.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        code,
        message,
        requestId: c.get('requestId') || c.req.header('CF-Ray') || crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...extra
    }

    // Set error tracking header
    c.header('X-Request-Id', body.requestId)

    return c.json(body, httpStatus as StatusCode)
}

export function validationErrorResponse(
    c: Context,
    errors: Array<{ field: string; message: string; code?: string }>
): Response {
    return errorResponse(c, ErrorCode.VALIDATION_ERROR, 'Data yang dikirim tidak valid', 400, {
        errors
    } as unknown as Partial<ErrorResponse>)
}

export function rateLimitResponse(
    c: Context,
    retryAfter: number,
    limit: number,
    remaining: number,
    reset: number
): Response {
    c.header('Retry-After', String(Math.ceil(retryAfter)))
    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(remaining))
    c.header('X-RateLimit-Reset', String(reset))

    return errorResponse(c, ErrorCode.RATE_LIMITED,
        'Terlalu banyak permintaan. Silakan coba lagi nanti.',
        429,
        { retryAfter, limit, remaining, reset } as unknown as Partial<ErrorResponse>
    )
}
```

### 3.4 Client-Side Error Parsing

```typescript
// frontend/src/services/api.ts
interface ApiError {
    error: string
    code: string
    message: string
    requestId: string
    timestamp: string
    errors?: Array<{ field: string; message: string }>
}

class ApiClient {
    private async request<T>(path: string, options?: RequestInit): Promise<T> {
        const response = await fetch(path, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers
            }
        })

        if (!response.ok) {
            const body = await response.json() as ApiError
            throw new ApiRequestError(response.status, body)
        }

        return response.json()
    }
}

export class ApiRequestError extends Error {
    public readonly status: number
    public readonly apiError: ApiError

    constructor(status: number, apiError: ApiError) {
        super(apiError.message)
        this.name = 'ApiRequestError'
        this.status = status
        this.apiError = apiError
    }

    get isAuthError(): boolean {
        return this.status === 401
    }

    get isValidationError(): boolean {
        return this.status === 400 && this.apiError.code === 'VALIDATION_ERROR'
    }

    get isRateLimited(): boolean {
        return this.status === 429
    }

    get isServerError(): boolean {
        return this.status >= 500
    }

    getFieldError(field: string): string | undefined {
        return this.apiError.errors?.find(e => e.field === field)?.message
    }
}
```

---

## 4. Global Error Handler

### 4.1 Server-Side Error Handler

```typescript
// src/middleware/error-handler.ts
import { HTTPException } from 'hono/http-exception'

async function errorHandler(c: Context, next: Next) {
    const startTime = Date.now()
    const requestId = c.req.header('CF-Ray') || crypto.randomUUID()
    c.set('requestId', requestId)

    try {
        await next()

        // Track slow requests
        const duration = Date.now() - startTime
        if (duration > 1000) {
            logger.warn('Slow request', {
                requestId,
                method: c.req.method,
                path: c.req.path,
                duration,
                userId: c.get('user')?.sub
            })
        }
    } catch (err) {
        const duration = Date.now() - startTime
        const error = normalizeError(err)
        const correlationId = requestId

        // Determine if this is an expected operational error
        if (error.isOperational) {
            logger[error.severity === ErrorSeverity.WARNING ? 'warn' : 'info'](
                error.message,
                {
                    requestId: correlationId,
                    code: error.code,
                    httpStatus: error.httpStatus,
                    path: c.req.path,
                    method: c.req.method,
                    userId: c.get('user')?.sub,
                    duration,
                    ...(error.details ? { details: error.details } : {})
                }
            )
        } else {
            // Programming error or system failure — log full details
            logger.error('Unhandled error', {
                requestId: correlationId,
                code: error.code,
                httpStatus: error.httpStatus,
                path: c.req.path,
                method: c.req.method,
                userId: c.get('user')?.sub,
                duration,
                error: error.message,
                stack: error.stack,
                cause: error.cause?.message
            })

            // Send to Sentry (only non-operational or critical errors)
            if (c.env.SENTRY_DSN && (error.severity === ErrorSeverity.CRITICAL || !error.isOperational)) {
                await captureSentryError(c, error, correlationId)
            }
        }

        // Build client-safe response
        const isProduction = c.env.ENVIRONMENT === 'production'
        const clientError = {
            error: getPublicErrorTitle(error.code),
            code: error.code,
            message: isProduction
                ? getPublicErrorMessage(error)
                : error.message,
            requestId: correlationId,
            timestamp: new Date().toISOString(),
            ...(error.code === ErrorCode.INSUFFICIENT_PERMISSIONS
                ? { errors: [] }
                : {})
        }

        // Include validation details if present
        if (error.details?.validationErrors) {
            clientError.errors = error.details.validationErrors
        }

        return c.json(clientError, error.httpStatus as StatusCode)
    }
}

function normalizeError(err: unknown): AppError {
    if (err instanceof AppError) {
        return err
    }

    if (err instanceof HTTPException) {
        return new AppError(
            err.status === 404 ? ErrorCode.SANTRI_NOT_FOUND : ErrorCode.INTERNAL_ERROR,
            err.message || 'Terjadi kesalahan',
            { httpStatus: err.status, isOperational: true }
        )
    }

    if (err instanceof SyntaxError && 'body' in err) {
        return new AppError(
            ErrorCode.INVALID_JSON,
            'Request body harus valid JSON',
            { httpStatus: 400, isOperational: true }
        )
    }

    if (err instanceof ZodError) {
        return new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Data yang dikirim tidak valid',
            {
                httpStatus: 400,
                details: {
                    validationErrors: err.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message,
                        code: e.code
                    }))
                },
                isOperational: true
            }
        )
    }

    if (isDatabaseError(err)) {
        return databaseError(err as Error)
    }

    // Unknown errors — treat as internal
    return new AppError(
        ErrorCode.INTERNAL_ERROR,
        'Terjadi kesalahan internal. Silakan coba lagi.',
        { httpStatus: 500, cause: err instanceof Error ? err : undefined, isOperational: false }
    )
}

function getPublicErrorTitle(code: ErrorCode): string {
    const titles: Partial<Record<ErrorCode, string>> = {
        [ErrorCode.VALIDATION_ERROR]: 'Validation Error',
        [ErrorCode.NO_TOKEN]: 'Unauthorized',
        [ErrorCode.INTERNAL_ERROR]: 'Internal Server Error',
        [ErrorCode.DATABASE_ERROR]: 'Service Unavailable',
        [ErrorCode.RATE_LIMITED]: 'Too Many Requests',
        [ErrorCode.SYNC_CONFLICT]: 'Sync Conflict'
    }
    return titles[code] || 'Error'
}

function getPublicErrorMessage(error: AppError): string {
    // Map internal codes to user-friendly messages
    const messages: Partial<Record<ErrorCode, string>> = {
        [ErrorCode.INTERNAL_ERROR]: 'Terjadi kesalahan internal. Silakan coba lagi.',
        [ErrorCode.DATABASE_ERROR]: 'Layanan sedang sibuk. Silakan coba lagi.',
        [ErrorCode.EXTERNAL_SERVICE_ERROR]: 'Layanan eksternal sedang bermasalah.',
        [ErrorCode.R2_ERROR]: 'Gagal mengunggah file. Silakan coba lagi.'
    }
    return messages[error.code] || error.message
}
```

### 4.2 Client-Side Error Handler

```typescript
// frontend/src/utils/error-handler.ts
import { toast } from '@/components/shared/toast'

interface ErrorHandlerConfig {
    showToast?: boolean
    redirectOnAuth?: boolean
    logToService?: boolean
    suppressErrors?: string[]  // Error codes to silently ignore
}

export async function handleApiError(
    error: unknown,
    config: ErrorHandlerConfig = {}
): Promise<void> {
    const {
        showToast = true,
        redirectOnAuth = true,
        logToService = true,
        suppressErrors = []
    } = config

    if (error instanceof ApiRequestError) {
        // Suppressed errors: silent fail
        if (suppressErrors.includes(error.apiError.code)) {
            return
        }

        // Auth errors: redirect to login
        if (error.isAuthError && redirectOnAuth) {
            if (showToast) {
                toast.error('Sesi telah berakhir. Silakan login kembali.')
            }
            // Redirect to login
            window.location.href = '/login'
            return
        }

        // Validation errors: handled by form components
        if (error.isValidationError) {
            // Return errors for form binding
            throw error
        }

        // Server errors: show generic message
        if (error.isServerError) {
            if (showToast) {
                toast.error('Terjadi kesalahan server. Silakan coba lagi.')
            }
            // Log to monitoring service
            if (logToService) {
                await logClientError(error)
            }
            return
        }

        // All other API errors
        if (showToast && error.apiError.message) {
            toast.error(error.apiError.message)
        }
        return
    }

    // Network errors (offline, timeout)
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
        // Handled by offline manager — no toast needed
        return
    }

    // Unknown errors
    console.error('[Client] Unhandled error:', error)
    if (showToast) {
        toast.error('Terjadi kesalahan yang tidak terduga.')
    }
    if (logToService) {
        await logClientError(error)
    }
}

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
    console.error('[Client] Unhandled rejection:', event.reason)
    logClientError(event.reason)
})

// Global error handler
window.addEventListener('error', (event) => {
    console.error('[Client] Global error:', event.error || event.message)
    logClientError(event.error || event.message)
})

async function logClientError(error: unknown): Promise<void> {
    try {
        await fetch('/api/client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                url: window.location.href,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString()
            }),
            // Don't wait for response — fire and forget
            keepalive: true
        })
    } catch {
        // Fail silently — can't log errors about logging errors
    }
}
```

---

## 5. Structured Logging

### 5.1 Logger Implementation

```typescript
// src/utils/logger.ts
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4
}

const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'debug',
    [LogLevel.INFO]: 'info',
    [LogLevel.WARN]: 'warn',
    [LogLevel.ERROR]: 'error',
    [LogLevel.FATAL]: 'fatal'
}

interface LogEntry {
    level: string
    message: string
    timestamp: string
    requestId?: string
    userId?: string
    service: string
    environment: string
    [key: string]: unknown
}

class Logger {
    private minLevel: LogLevel
    private service: string
    private environment: string

    constructor(env: Env) {
        this.minLevel = parseLogLevel(env.LOG_LEVEL || 'info')
        this.service = 'santrivora-api'
        this.environment = env.ENVIRONMENT || 'development'
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.minLevel
    }

    private createEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): LogEntry {
        return {
            level: LOG_LEVEL_LABELS[level],
            message,
            timestamp: new Date().toISOString(),
            service: this.service,
            environment: this.environment,
            ...meta
        }
    }

    debug(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            const entry = this.createEntry(LogLevel.DEBUG, message, meta)
            console.debug(JSON.stringify(entry))
        }
    }

    info(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.INFO)) {
            const entry = this.createEntry(LogLevel.INFO, message, meta)
            console.info(JSON.stringify(entry))
        }
    }

    warn(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.WARN)) {
            const entry = this.createEntry(LogLevel.WARN, message, meta)
            console.warn(JSON.stringify(entry))
        }
    }

    error(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            const entry = this.createEntry(LogLevel.ERROR, message, meta)
            console.error(JSON.stringify(entry))
        }
    }

    fatal(message: string, meta?: Record<string, unknown>): void {
        const entry = this.createEntry(LogLevel.FATAL, message, meta)
        console.error(JSON.stringify(entry))
    }
}

function parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
        case 'debug': return LogLevel.DEBUG
        case 'info': return LogLevel.INFO
        case 'warn': return LogLevel.WARN
        case 'error': return LogLevel.ERROR
        default: return LogLevel.INFO
    }
}

export let logger: Logger

export function initLogger(env: Env): void {
    logger = new Logger(env)
}
```

### 5.2 Log Format Specification

All logs are emitted as single-line JSON objects for machine parsing:

```json
{
    "level": "error",
    "message": "D1 query failed",
    "timestamp": "2026-07-06T12:00:00.000Z",
    "service": "santrivora-api",
    "environment": "production",
    "requestId": "cf-ray-abc123",
    "userId": "user-uuid",
    "duration": 342,
    "error": "UNIQUE constraint failed: users.email",
    "query": "INSERT INTO users (...) VALUES (...)"
}
```

### 5.3 Request Logging Middleware

```typescript
// src/middleware/request-logger.ts
async function requestLogger(c: Context, next: Next) {
    const start = Date.now()
    const requestId = c.get('requestId')
    const method = c.req.method
    const path = c.req.path

    // Log incoming request (debug level)
    logger.debug('Incoming request', {
        requestId,
        method,
        path,
        query: c.req.query(),
        userId: c.get('user')?.sub,
        ip: getClientIP(c),
        userAgent: c.req.header('User-Agent')
    })

    await next()

    // Log completed request
    const duration = Date.now() - start
    const status = c.res.status

    const logMeta = {
        requestId,
        method,
        path,
        status,
        duration: `${duration}ms`,
        userId: c.get('user')?.sub
    }

    if (status >= 500) {
        logger.error('Request failed', logMeta)
    } else if (duration > 500) {
        logger.warn('Slow request', logMeta)
    } else {
        logger.info('Request completed', logMeta)
    }
}
```

### 5.4 Correlation ID Propagation

```typescript
// Every request gets a correlation ID that propagates through the entire stack
// Server-side: CF-Ray header or generated UUID
// Client-side: X-Request-Id header or generated UUID

async function correlationMiddleware(c: Context, next: Next) {
    const correlationId = c.req.header('X-Correlation-Id')
        || c.req.header('CF-Ray')
        || crypto.randomUUID()

    c.set('requestId', correlationId)
    c.header('X-Request-Id', correlationId)

    await next()
}

// Client-side correlation ID generation
function generateCorrelationId(): string {
    return `client_${crypto.randomUUID()}`
}

// Attach to all API requests
async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(path, {
        ...options,
        headers: {
            ...options?.headers,
            'X-Correlation-Id': generateCorrelationId()
        }
    })
}
```

---

## 6. Error Tracking with Sentry

### 6.1 Sentry Setup

```typescript
// src/middleware/sentry.ts
import * as Sentry from '@sentry/cloudflare'

interface SentryConfig {
    dsn: string
    environment: string
    release: string
    tracesSampleRate: number
}

export function initSentry(env: Env): SentryConfig | null {
    if (!env.SENTRY_DSN) {
        logger.warn('Sentry DSN not configured — skipping error tracking')
        return null
    }

    const config: SentryConfig = {
        dsn: env.SENTRY_DSN,
        environment: env.ENVIRONMENT || 'development',
        release: env.CF_PAGES_COMMIT_SHA || 'unknown',
        tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.1 : 1.0  // 10% in prod
    }

    Sentry.init({
        dsn: config.dsn,
        environment: config.environment,
        release: config.release,
        tracesSampleRate: config.tracesSampleRate,
        // Don't send errors in development
        enabled: env.ENVIRONMENT !== 'development',
        // Integrations
        integrations: [
            Sentry.httpIntegration(),
            Sentry.consoleIntegration()
        ],
        // Filter out expected errors
        beforeSend(event) {
            return filterSentryEvent(event)
        }
    })

    return config
}

function filterSentryEvent(event: Sentry.Event): Sentry.Event | null {
    // Ignore expected operational errors
    const ignoredCodes = [
        ErrorCode.NO_TOKEN,
        ErrorCode.TOKEN_EXPIRED,
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.RATE_LIMITED,
        ErrorCode.SANTRI_NOT_FOUND,
        ErrorCode.KELAS_NOT_FOUND
    ]

    if (event.extra?.errorCode && ignoredCodes.includes(event.extra.errorCode as ErrorCode)) {
        return null
    }

    return event
}
```

### 6.2 Error Context Enrichment

```typescript
// Enrich Sentry events with request context
async function captureSentryError(
    c: Context,
    error: AppError,
    correlationId: string
): Promise<void> {
    Sentry.withScope((scope) => {
        // Set user context
        const user = c.get('user')
        if (user) {
            scope.setUser({
                id: user.sub,
                email: user.email,
                role: user.role
            })
        }

        // Set request context
        scope.setContext('request', {
            method: c.req.method,
            path: c.req.path,
            query: c.req.query(),
            headers: {
                'user-agent': c.req.header('User-Agent'),
                'cf-ray': c.req.header('CF-Ray'),
                'cf-ipcountry': c.req.header('CF-IPCountry')
            }
        })

        // Set environment context
        scope.setContext('environment', {
            environment: c.env.ENVIRONMENT,
            release: c.env.CF_PAGES_COMMIT_SHA,
            correlationId
        })

        // Set error metadata
        scope.setTag('error_code', error.code)
        scope.setTag('http_status', error.httpStatus)
        scope.setTag('severity', error.severity)
        scope.setTag('is_operational', String(error.isOperational))

        // Set extra data
        scope.setExtra('errorDetails', error.details)
        scope.setExtra('correlationId', correlationId)

        // Set level based on severity
        scope.setLevel(
            error.severity === ErrorSeverity.CRITICAL
                ? 'fatal'
                : error.severity === ErrorSeverity.ERROR
                    ? 'error'
                    : 'warning'
        )

        // Capture the error
        if (error.cause) {
            Sentry.captureException(error.cause, {
                mechanism: {
                    type: 'chained',
                    handled: error.isOperational
                }
            })
        } else {
            Sentry.captureException(error, {
                mechanism: {
                    type: 'appError',
                    handled: error.isOperational
                }
            })
        }
    })
}
```

### 6.3 Performance Tracing

```typescript
// Track database query performance
async function tracedQuery<T>(
    env: Env,
    queryName: string,
    queryFn: () => Promise<T>
): Promise<T> {
    const transaction = Sentry.getCurrentHub()?.getScope()?.getTransaction()
    const span = transaction?.startChild({
        op: 'db.query',
        description: queryName
    })

    const start = Date.now()
    try {
        const result = await queryFn()
        span?.setHttpStatus(200)
        return result
    } catch (err) {
        span?.setStatus('internal_error')
        throw err
    } finally {
        span?.finish()
        const duration = Date.now() - start
        if (duration > 100) {
            logger.warn('Slow database query', {
                query: queryName,
                duration: `${duration}ms`
            })
        }
    }
}
```

### 6.4 Client-Side Sentry

```typescript
// frontend/src/services/monitoring.ts
import * as Sentry from '@sentry/vue'
import { createRouter } from 'vue-router'

export function initClientMonitoring(app: VueApp, router: ReturnType<typeof createRouter>) {
    if (!import.meta.env.VITE_SENTRY_DSN) return

    Sentry.init({
        app,
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_COMMIT_SHA,
        integrations: [
            Sentry.browserTracingIntegration({ router }),
            Sentry.replayIntegration({
                maskAllText: true,
                blockAllMedia: true
            })
        ],
        tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
        replaysSessionSampleRate: 0.01,    // 1% of sessions
        replaysOnErrorSampleRate: 1.0,     // 100% of errors
        beforeSend(event) {
            // Filter out known non-actionable errors
            const ignoredMessages = [
                'ResizeObserver loop limit exceeded',
                'NetworkError when attempting to fetch resource'
            ]
            if (event.message && ignoredMessages.some(m =>
                event.message!.includes(m)
            )) {
                return null
            }
            return event
        }
    })

    // Set user context after login
    Sentry.setUser({
        id: userStore.id,
        email: userStore.email,
        role: userStore.role
    })
}
```

---

## 7. Logpush Configuration

### 7.1 Cloudflare Logpush Setup

```toml
# wrangler.toml
# Logpush is configured at the Cloudflare dashboard level
# But we can enable structured logging from the Worker

# Enable Workers Trace
[observability]
enabled = true
head_sampling_rate = 0.25  # Log 25% of requests

# Environment variables for log destinations
[vars]
LOG_LEVEL = "info"
LOG_TO_SENTRY = true
```

### 7.2 Logpush to R2

```typescript
// Worker-side: Write audit logs to R2 for long-term retention
async function writeAuditLogToR2(env: Env, entry: LogEntry): Promise<void> {
    const date = new Date().toISOString().split('T')[0]  // 2026-07-06
    const key = `logs/${date}/${entry.requestId || crypto.randomUUID()}.json`

    await env.R2.put(key, JSON.stringify(entry), {
        httpMetadata: {
            contentType: 'application/json'
        },
        customMetadata: {
            level: entry.level,
            environment: entry.environment
        }
    })
}

// Scheduled task: cleanup old logs
async function cleanupOldLogs(env: Env): Promise<void> {
    const retentionDays = 90
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - retentionDays)

    const objects = await env.R2.list({
        prefix: 'logs/',
        startAfter: cutoff.toISOString().split('T')[0]
    })

    // Delete objects older than retention period
    for (const object of objects.objects) {
        await env.R2.delete(object.key)
    }
}
```

### 6.3 Error Context Enrichment -> actually let me fix numbering

Actually wait — I'm jumping from 6.2 to 7. Let me restructure properly.

### 7.3 Logpush via API

```typescript
// Alternative: Push logs directly to external service via Logpush API
// Configured in Cloudflare Dashboard > Analytics & Logs > Logpush

// Expected log format for Logpush:
// Each log line is a JSON object with these fields for structured querying
interface LogpushEntry {
    // Worker metadata
    WorkerName: string
    RequestId: string
    Timestamp: number

    // Request info
    Method: string
    Path: string
    Status: number
    Duration: number

    // Error info
    ErrorCode?: string
    ErrorMessage?: string

    // User info
    UserId?: string
    UserRole?: string
    UserEmail?: string

    // Geo
    IP: string
    Country: string
    City: string
    Colo: string

    // Edge
    RayId: string
    EdgeResponseStatus: number
    OriginResponseStatus: number
}

// Example Logpush job configuration:
/*
{
    "dataset": "workers_trace",
    "enabled": true,
    "destination": "https://your-destination.com/logs",
    "filter": {
        "where": {
            "and": [
                { "key": "Outcome", "operator": "neq", "value": "ok" },
                { "key": "ScriptName", "operator": "eq", "value": "santrivora-worker" }
            ]
        }
    }
}
*/
```

### 7.4 Log Retention Policy

| Log Type | Retention | Storage | Purpose |
|---|---|---|---|
| Application logs (stdout) | 7 days | Cloudflare Workers Trace | Real-time debugging |
| Error logs | 30 days | Sentry | Error tracking & alerting |
| Audit trail | 90 days | D1 `audit_log` table | Compliance & investigation |
| Raw request logs | 90 days | R2 (compressed) | Forensics & analytics |
| Performance traces | 30 days | Sentry | Performance monitoring |

---

## 8. Alerting Rules

### 8.1 Alert Configuration

```typescript
// src/config/alerts.ts
interface AlertRule {
    name: string
    condition: AlertCondition
    channels: AlertChannel[]
    cooldown: number  // Minutes between alerts
    severity: 'critical' | 'warning' | 'info'
}

type AlertCondition =
    | { type: 'error_rate'; threshold: number; window: number }     // Error rate > X% in Y minutes
    | { type: 'error_count'; code: ErrorCode; threshold: number }   // More than X of specific error
    | { type: 'latency'; threshold: number }                         // p95 latency > X ms
    | { type: 'sync_failure'; threshold: number }                    // Sync failures > X in window
    | { type: 'rate_limit_hit'; threshold: number }                  // Rate limit hits > X

type AlertChannel = 'email' | 'sentry' | 'webhook' | 'dashboard'

const ALERT_RULES: AlertRule[] = [
    // Critical: High error rate
    {
        name: 'high-error-rate',
        condition: { type: 'error_rate', threshold: 5, window: 5 }, // >5% errors in 5 min
        channels: ['sentry', 'email'],
        cooldown: 15,
        severity: 'critical'
    },
    // Critical: Database errors
    {
        name: 'database-errors',
        condition: { type: 'error_count', code: ErrorCode.DATABASE_ERROR, threshold: 10 },
        channels: ['sentry', 'email', 'dashboard'],
        cooldown: 5,
        severity: 'critical'
    },
    // Warning: Sync failures
    {
        name: 'sync-failures',
        condition: { type: 'sync_failure', threshold: 20 },
        channels: ['sentry', 'dashboard'],
        cooldown: 30,
        severity: 'warning'
    },
    // Warning: Rate limit violations
    {
        name: 'rate-limit-hits',
        condition: { type: 'rate_limit_hit', threshold: 50 },  // 50 rate limit hits in window
        channels: ['dashboard'],
        cooldown: 60,
        severity: 'warning'
    },
    // Warning: High latency
    {
        name: 'high-latency',
        condition: { type: 'latency', threshold: 2000 },  // p95 > 2s
        channels: ['sentry'],
        cooldown: 30,
        severity: 'warning'
    },
    // Info: Failed login attempts surge
    {
        name: 'login-surge',
        condition: { type: 'error_count', code: ErrorCode.INVALID_CREDENTIALS, threshold: 100 },
        channels: ['dashboard'],
        cooldown: 60,
        severity: 'info'
    }
]
```

### 8.2 Alert Evaluation Engine

```typescript
// src/services/alerting.ts
class AlertManager {
    private rules: AlertRule[]
    private lastAlerted: Map<string, Date> = new Map()
    private metrics: Map<string, number[]> = new Map()

    constructor() {
        this.rules = ALERT_RULES
    }

    // Record an event for evaluation
    recordEvent(event: AlertEvent): void {
        const key = event.type
        if (!this.metrics.has(key)) {
            this.metrics.set(key, [])
        }

        const events = this.metrics.get(key)!
        events.push(event.timestamp)

        // Keep only last 5 minutes of events
        const cutoff = Date.now() - 5 * 60 * 1000
        while (events.length > 0 && events[0] < cutoff) {
            events.shift()
        }

        // Evaluate rules
        this.evaluateRules()
    }

    private evaluateRules(): void {
        for (const rule of this.rules) {
            if (this.shouldAlert(rule)) {
                this.fireAlert(rule)
            }
        }
    }

    private shouldAlert(rule: AlertRule): boolean {
        // Check cooldown
        const lastAlert = this.lastAlerted.get(rule.name)
        if (lastAlert) {
            const cooldownMs = rule.cooldown * 60 * 1000
            if (Date.now() - lastAlert.getTime() < cooldownMs) {
                return false
            }
        }

        // Check condition
        switch (rule.condition.type) {
            case 'error_rate': {
                const totalEvents = this.getEventCount('request', rule.condition.window)
                const errorEvents = this.getEventCount('error', rule.condition.window)
                if (totalEvents === 0) return false
                return (errorEvents / totalEvents * 100) > rule.condition.threshold
            }
            case 'error_count': {
                const count = this.getErrorCodeCount(
                    rule.condition.code,
                    rule.condition.threshold
                )
                return count >= rule.condition.threshold
            }
            case 'sync_failure': {
                const failures = this.getEventCount('sync_failure', 5)
                return failures >= rule.condition.threshold
            }
            case 'rate_limit_hit': {
                const hits = this.getEventCount('rate_limit', 5)
                return hits >= rule.condition.threshold
            }
            default:
                return false
        }
    }

    private async fireAlert(rule: AlertRule): Promise<void> {
        this.lastAlerted.set(rule.name, new Date())

        const alertPayload = {
            rule: rule.name,
            severity: rule.severity,
            timestamp: new Date().toISOString(),
            metrics: this.getMetricsSnapshot()
        }

        for (const channel of rule.channels) {
            switch (channel) {
                case 'sentry':
                    Sentry.captureEvent({
                        message: `Alert: ${rule.name}`,
                        level: rule.severity === 'critical' ? 'fatal' : 'warning',
                        extra: alertPayload
                    })
                    break
                case 'dashboard':
                    await this.sendDashboardAlert(alertPayload)
                    break
                case 'email':
                    await this.sendEmailAlert(alertPayload)
                    break
                case 'webhook':
                    await this.sendWebhookAlert(alertPayload)
                    break
            }
        }

        logger.warn('Alert fired', alertPayload)
    }

    private async sendEmailAlert(payload: AlertPayload): Promise<void> {
        // Send via Workers Email or external email service
        // This is a placeholder — implement with actual email service
        logger.info('Email alert would be sent', payload)
    }

    private async sendWebhookAlert(payload: AlertPayload): Promise<void> {
        // Send to Slack, Discord, or custom webhook
        const webhookUrl = process.env.ALERT_WEBHOOK_URL
        if (!webhookUrl) return

        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `[${payload.severity.toUpperCase()}] ${payload.rule}`,
                attachments: [{
                    fields: Object.entries(payload.metrics).map(([key, value]) => ({
                        title: key,
                        value: String(value),
                        short: true
                    }))
                }]
            })
        }).catch(err => {
            logger.error('Failed to send webhook alert', { error: err.message })
        })
    }

    private getMetricsSnapshot(): Record<string, number> {
        return {
            errorRate: this.calculateErrorRate(),
            activeUsers: this.getActiveUsers(),
            pendingSyncCount: this.getPendingSyncCount(),
            queueSize: this.getQueueSize()
        }
    }
}
```

### 8.3 Sentry Alert Rules

Configure these alert rules in the Sentry dashboard (Alerts > Create Alert):

```yaml
# Alert: Critical error rate spike
name: "SantriVora: High Error Rate"
conditions:
  - metric: error_count
    aggregation: count
    time_window: 5m
    threshold: 50
    threshold_type: above
actions:
  - type: email
    targets: ["ops@santrivora.com"]
  - type: slack
    webhook: "https://hooks.slack.com/services/..."
    channel: "#alerts"
frequency: 5 minutes

# Alert: Database errors
name: "SantriVora: Database Errors"
conditions:
  - metric: error_count
    aggregation: count
    time_window: 5m
    threshold: 10
    threshold_type: above
    filters:
      - key: error_code
        value: DATABASE_ERROR
actions:
  - type: email
    targets: ["ops@santrivora.com", "admin@santrivora.com"]
  - type: slack
    channel: "#alerts-critical"
frequency: 2 minutes

# Alert: Sync failure rate
name: "SantriVora: Sync Failures"
conditions:
  - metric: error_count
    aggregation: count
    time_window: 15m
    threshold: 30
    threshold_type: above
    filters:
      - key: error_code
        value: SYNC_FAILED
actions:
  - type: slack
    channel: "#sync-alerts"
frequency: 15 minutes

# Alert: P95 latency spike
name: "SantriVora: High Latency"
conditions:
  - metric: transaction_duration
    aggregation: percentile(0.95)
    time_window: 5m
    threshold: 2000
    threshold_type: above
actions:
  - type: slack
    channel: "#perf-alerts"
frequency: 5 minutes
```

---

## 9. Debugging in Production

### 9.1 Request ID Tracing

Every request gets a traceable ID that flows through the entire system:

```
Client → X-Correlation-Id → Worker → Request-Id → D1 Query → R2 → Logs → Sentry
```

```typescript
// Debug endpoint — returns the full context of a request
// Only accessible by admins in production
async function debugRequest(c: Context) {
    const admin = c.get('user')
    if (admin.role !== 'admin') {
        return forbidden('Only admins can access debug information')
    }

    const requestId = c.req.param('requestId')

    // Search logs in R2 for the request
    const logEntry = await findLogEntry(c.env, requestId)

    // Get Sentry event if exists
    const sentryEvent = await findSentryEvent(requestId)

    // Get worker trace
    const trace = await getWorkerTrace(c.env, requestId)

    return c.json({
        requestId,
        logEntry,
        sentryEvent,
        trace,
        // Redact sensitive fields
        redacted: ['password_hash', 'token', 'secret']
    })
}
```

### 9.2 Production Debug Commands

```typescript
// Debug endpoints — enabled only for admins in production
// All debug endpoints require admin role and produce detailed output

// GET /api/debug/request/:requestId — Full request trace
// GET /api/debug/logs — Recent error logs
// GET /api/debug/health — System health check
// GET /api/debug/cache — Cache inspection
// POST /api/debug/sync-test — Force sync test for specific user

async function healthCheck(c: Context): Promise<Response> {
    const checks = {
        database: await checkDatabase(c.env),
        kv: await checkKV(c.env),
        r2: await checkR2(c.env),
        sentry: !!c.env.SENTRY_DSN,
        environment: c.env.ENVIRONMENT,
        version: c.env.CF_PAGES_COMMIT_SHA || 'unknown',
        uptime: process.uptime()
    }

    const healthy = Object.values(checks)
        .filter(v => typeof v === 'object' && v !== null)
        .every(v => (v as HealthCheckResult).healthy)

    return c.json({
        status: healthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        checks
    }, healthy ? 200 : 503)
}

async function checkDatabase(env: Env): Promise<HealthCheckResult> {
    try {
        const start = Date.now()
        await env.DB.prepare('SELECT 1').run()
        return {
            healthy: true,
            latency: Date.now() - start
        }
    } catch (err) {
        return {
            healthy: false,
            error: err instanceof Error ? err.message : 'Unknown',
            latency: Date.now() - start
        }
    }
}

// GET /api/debug/errors — Paginated error log viewer
async function getErrorLogs(c: Context): Promise<Response> {
    const { cursor, limit = 50, level = 'error' } = c.req.query()

    const logs = await env.DB.prepare(`
        SELECT id, level, message, timestamp, request_id, user_id
        FROM error_logs
        WHERE level >= ?
        ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC
        LIMIT ?
    `).bind(level, cursor, limit + 1).all()

    // ... return paginated results
}
```

### 9.3 Structured Debugging Patterns

```typescript
// src/utils/debug.ts
export function logQueryExecution(query: string, params: unknown[], duration: number): void {
    logger.debug('Query executed', {
        query: query.substring(0, 200),  // Truncate long queries
        params: sanitizeLogParams(params),
        duration: `${duration}ms`
    })
}

function sanitizeLogParams(params: unknown[]): unknown[] {
    // Never log passwords, tokens, or secrets
    return params.map(p => {
        if (typeof p === 'string' && p.length > 100) {
            return `${p.substring(0, 20)}... [truncated ${p.length - 20} chars]`
        }
        return p
    })
}

// Debug logging for sync operations
export function logSyncOperation(
    operation: string,
    entityType: string,
    entityId: string,
    details?: Record<string, unknown>
): void {
    logger.info('Sync operation', {
        operation,
        entityType,
        entityId,
        ...details,
        // Remove data payloads to keep logs small
        dataPayload: undefined
    })
}

// Trace logging for complex operations
export function createTrace(operation: string): TraceSpan {
    const start = Date.now()
    const id = crypto.randomUUID()

    logger.debug(`Trace started: ${operation}`, { traceId: id })

    return {
        id,
        operation,
        start,
        end() {
            const duration = Date.now() - start
            logger.debug(`Trace completed: ${operation}`, {
                traceId: id,
                duration: `${duration}ms`
            })
            return duration
        },
        child(subOperation: string) {
            return createTrace(`${operation} > ${subOperation}`)
        }
    }
}

interface TraceSpan {
    id: string
    operation: string
    start: number
    end(): number
    child(subOperation: string): TraceSpan
}
```

### 9.4 Client-Side Debugging

```typescript
// frontend/src/utils/debug.ts
// Only active in development or with ?debug=true query param
const isDebugMode = (): boolean => {
    if (import.meta.env.DEV) return true
    return window.location.search.includes('debug=true')
}

class ClientDebugger {
    private logs: ClientLogEntry[] = []
    private maxLogs: number = 200

    log(level: string, message: string, meta?: Record<string, unknown>): void {
        if (!isDebugMode()) return

        const entry: ClientLogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            meta,
            stack: new Error().stack?.split('\n').slice(2, 5).join('\n')
        }

        this.logs.push(entry)
        if (this.logs.length > this.maxLogs) {
            this.logs.shift()
        }

        if (level === 'error') {
            console.error(`[ClientDebug] ${message}`, meta)
        } else {
            console.log(`[ClientDebug] ${message}`, meta)
        }
    }

    // Show debug overlay
    showOverlay(): void {
        if (!isDebugMode()) return

        const overlay = document.createElement('div')
        overlay.id = 'debug-overlay'
        overlay.style.cssText = `
            position: fixed; bottom: 0; right: 0; width: 400px; height: 300px;
            background: rgba(0,0,0,0.9); color: #0f0; font-family: monospace;
            font-size: 12px; overflow: auto; z-index: 99999; padding: 8px;
        `
        overlay.textContent = this.logs
            .slice(-50)
            .map(l => `[${l.level}] ${l.timestamp.split('T')[1].split('.')[0]} ${l.message}`)
            .join('\n')

        document.body.appendChild(overlay)
    }

    // Export logs for bug reports
    exportLogs(): string {
        return JSON.stringify({
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            logs: this.logs
        }, null, 2)
    }
}

export const clientDebug = new ClientDebugger()

// Add keyboard shortcut to show debug info
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        clientDebug.showOverlay()
    }
})
```

---

## 10. Error Recovery Strategies

### 10.1 Retry Strategy Map

```typescript
// src/config/retry.ts
interface RetryConfig {
    maxRetries: number
    baseDelay: number      // milliseconds
    maxDelay: number       // milliseconds
    backoffFactor: number  // exponential factor
    jitter: boolean        // add randomness to delay
    retryableErrors: ErrorCode[]  // which errors trigger retry
    onRetry?: (attempt: number, error: AppError) => void
}

const RETRY_STRATEGIES: Record<string, RetryConfig> = {
    // Database operations: conservative retry
    database: {
        maxRetries: 3,
        baseDelay: 100,
        maxDelay: 2000,
        backoffFactor: 2,
        jitter: true,
        retryableErrors: [
            ErrorCode.DATABASE_ERROR,
            ErrorCode.EXTERNAL_SERVICE_ERROR
        ]
    },

    // Sync operations: aggressive retry with longer backoff
    sync: {
        maxRetries: 10,
        baseDelay: 1000,
        maxDelay: 300000,    // 5 minutes
        backoffFactor: 2,
        jitter: true,
        retryableErrors: [
            ErrorCode.SYNC_FAILED,
            ErrorCode.DATABASE_ERROR,
            ErrorCode.EXTERNAL_SERVICE_ERROR
        ],
        onRetry: (attempt, error) => {
            logger.warn('Sync retry scheduled', {
                attempt,
                error: error.code,
                nextRetry: calculateNextRetry(attempt)
            })
        }
    },

    // R2 operations: quick retry
    storage: {
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 2000,
        backoffFactor: 2,
        jitter: false,
        retryableErrors: [
            ErrorCode.R2_ERROR
        ]
    }
}
```

### 10.2 Retry Executor

```typescript
// src/utils/retry.ts
async function withRetry<T>(
    operation: string,
    fn: () => Promise<T>,
    strategy: RetryConfig = RETRY_STRATEGIES.database
): Promise<T> {
    let lastError: Error | undefined
    const startTime = Date.now()

    for (let attempt = 1; attempt <= strategy.maxRetries; attempt++) {
        try {
            const result = await fn()

            // Log successful retry after failure
            if (attempt > 1) {
                logger.info(`${operation} succeeded after retry`, {
                    attempt,
                    totalDuration: Date.now() - startTime
                })
            }

            return result
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
            const appError = normalizeError(lastError)

            // Check if this error is retryable
            if (!appError.isOperational ||
                !strategy.retryableErrors.includes(appError.code)) {
                throw err  // Not retryable
            }

            // Last attempt — throw
            if (attempt === strategy.maxRetries) {
                logger.error(`${operation} failed after ${attempt} attempts`, {
                    error: appError.message,
                    totalDuration: Date.now() - startTime
                })
                throw err
            }

            // Calculate delay with exponential backoff
            const delay = calculateDelay(attempt, strategy)

            // Notify on retry
            strategy.onRetry?.(attempt, appError)

            logger.warn(`${operation} failed, retrying in ${delay}ms`, {
                attempt,
                error: appError.code,
                delay
            })

            // Wait before next attempt
            await sleep(delay)
        }
    }

    // Should never reach here
    throw lastError || new Error(`Retry exhausted for ${operation}`)
}

function calculateDelay(attempt: number, strategy: RetryConfig): number {
    const exponential = strategy.baseDelay * Math.pow(strategy.backoffFactor, attempt - 1)
    const capped = Math.min(exponential, strategy.maxDelay)

    if (!strategy.jitter) return capped

    // Add ±25% jitter to prevent thundering herd
    const jitterRange = capped * 0.25
    return capped + (Math.random() * jitterRange * 2 - jitterRange)
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
```

### 10.3 Graceful Degradation

```typescript
// src/services/degradation.ts
enum ServiceStatus {
    HEALTHY = 'healthy',
    DEGRADED = 'degraded',
    DOWN = 'down'
}

class GracefulDegradation {
    private status: Map<string, ServiceStatus> = new Map()
    private fallbacks: Map<string, () => Promise<unknown>> = new Map()

    // Register a fallback function for critical services
    registerFallback(service: string, fallback: () => Promise<unknown>): void {
        this.fallbacks.set(service, fallback)
        this.status.set(service, ServiceStatus.HEALTHY)
    }

    // Execute operation with fallback
    async execute<T>(
        service: string,
        primary: () => Promise<T>,
        options?: {
            timeout?: number        // Operation timeout
            fallback?: () => Promise<T>
            critical?: boolean      // If true, failure propagates
        }
    ): Promise<T> {
        const currentStatus = this.status.get(service) || ServiceStatus.HEALTHY

        // Service is down — use fallback directly
        if (currentStatus === ServiceStatus.DOWN) {
            return this.executeFallback(service, options?.fallback) as Promise<T>
        }

        try {
            // Execute with optional timeout
            const result = options?.timeout
                ? await Promise.race([
                    primary(),
                    timeout(options.timeout)
                ])
                : await primary()

            // Reset degradation on success
            this.status.set(service, ServiceStatus.HEALTHY)
            return result as T
        } catch (err) {
            // Check if service should be degraded
            this.degradeService(service)

            // If fallback is available, use it
            if (options?.fallback) {
                logger.warn(`Service ${service} degraded, using fallback`)
                return this.executeFallback(service, options.fallback) as Promise<T>
            }

            // Critical service — propagate failure
            if (options?.critical) {
                throw err
            }

            // Non-critical service — return empty/default
            logger.warn(`Service ${service} failed silently`, {
                error: err instanceof Error ? err.message : 'Unknown'
            })
            return null as T
        }
    }

    private degradeService(service: string): void {
        const current = this.status.get(service) || ServiceStatus.HEALTHY

        switch (current) {
            case ServiceStatus.HEALTHY:
                this.status.set(service, ServiceStatus.DEGRADED)
                break
            case ServiceStatus.DEGRADED:
                this.status.set(service, ServiceStatus.DOWN)
                break
        }

        // Auto-recovery: reset after 30 seconds
        setTimeout(() => {
            this.status.set(service, ServiceStatus.HEALTHY)
            logger.info(`Service ${service} auto-recovered`)
        }, 30000)
    }

    private async executeFallback(
        service: string,
        fallback?: () => Promise<unknown>
    ): Promise<unknown> {
        const fb = fallback || this.fallbacks.get(service)
        if (!fb) {
            throw new Error(`No fallback available for ${service}`)
        }
        return fb()
    }

    getStatus(service: string): ServiceStatus {
        return this.status.get(service) || ServiceStatus.HEALTHY
    }

    isHealthy(): boolean {
        return Array.from(this.status.values())
            .every(s => s === ServiceStatus.HEALTHY)
    }
}

function timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    })
}

export const degradation = new GracefulDegradation()

// Register known fallbacks at startup
degradation.registerFallback('santri-sync', async () => {
    // Offline: use local IndexedDB
    logger.info('Sync service degraded — using local storage')
    return { source: 'local', offline: true }
})

degradation.registerFallback('analytics', async () => {
    // Dashboard: return empty data when DB is slow
    logger.info('Analytics service degraded — returning empty data')
    return {
        summary: { total_santri: 0, total_catatan: 0 },
        trends: [],
        cached: false
    }
})
```

### 10.4 Offline Recovery (Client-Side)

```typescript
// frontend/src/services/recovery.ts
class OfflineRecoveryManager {
    private recoveryQueue: RecoveryAction[] = []
    private maxRecoveryAttempts: number = 10

    // Queue a recovery action to run when online
    queueRecovery(action: RecoveryAction): void {
        this.recoveryQueue.push(action)

        // Try to process immediately
        if (navigator.onLine) {
            this.processRecoveryQueue()
        }
    }

    // Process all queued recovery actions
    async processRecoveryQueue(): Promise<void> {
        if (!navigator.onLine || this.recoveryQueue.length === 0) return

        logger.info(`Processing ${this.recoveryQueue.length} recovery actions`)

        const queue = [...this.recoveryQueue]
        this.recoveryQueue = []

        for (const action of queue) {
            try {
                await action.execute()
                logger.info(`Recovery action completed: ${action.name}`)
            } catch (err) {
                action.retryCount++

                if (action.retryCount >= this.maxRecoveryAttempts) {
                    logger.error(`Recovery action failed permanently: ${action.name}`, {
                        error: err
                    })
                    // Notify user
                    toast.error(`Gagal memulihkan: ${action.name}. Data aman secara lokal.`)
                } else {
                    // Re-queue with backoff
                    setTimeout(() => {
                        this.recoveryQueue.push(action)
                        this.processRecoveryQueue()
                    }, Math.min(1000 * Math.pow(2, action.retryCount), 300000))
                }
            }
        }
    }
}

interface RecoveryAction {
    name: string
    execute: () => Promise<void>
    retryCount: number
    priority: 'high' | 'normal' | 'low'
}

export const recoveryManager = new OfflineRecoveryManager()

// Register connection recovery handler
window.addEventListener('online', () => {
    logger.info('Connection restored — processing recovery queue')
    recoveryManager.processRecoveryQueue()
    syncQueue.triggerSync()
})
```

### 10.5 Circuit Breaker Pattern

```typescript
// src/utils/circuit-breaker.ts
class CircuitBreaker {
    private failures: number = 0
    private lastFailureTime: number = 0
    private state: 'closed' | 'open' | 'half-open' = 'closed'

    private threshold: number    // Failures before opening circuit
    private timeout: number      // Time before half-open
    private halfOpenMaxRequests: number = 1

    constructor(
        private name: string,
        options?: {
            threshold?: number
            timeout?: number
        }
    ) {
        this.threshold = options?.threshold ?? 5
        this.timeout = options?.timeout ?? 30000
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            // Check if timeout has elapsed
            if (Date.now() - this.lastFailureTime >= this.timeout) {
                this.state = 'half-open'
            } else {
                throw new Error(`Circuit breaker open for ${this.name}`)
            }
        }

        try {
            const result = await fn()
            this.onSuccess()
            return result
        } catch (err) {
            this.onFailure()
            throw err
        }
    }

    private onSuccess(): void {
        this.failures = 0
        this.state = 'closed'
    }

    private onFailure(): void {
        this.failures++
        this.lastFailureTime = Date.now()

        if (this.failures >= this.threshold) {
            this.state = 'open'
            logger.warn(`Circuit breaker opened for ${this.name}`, {
                failures: this.failures,
                threshold: this.threshold,
                timeout: this.timeout
            })
        }
    }

    getState(): string {
        return this.state
    }

    reset(): void {
        this.failures = 0
        this.state = 'closed'
    }
}

// Usage
const dbCircuitBreaker = new CircuitBreaker('database', {
    threshold: 5,
    timeout: 30000
})

async function queryWithCircuitBreaker<T>(queryFn: () => Promise<T>): Promise<T> {
    return dbCircuitBreaker.execute(queryFn)
}
```

### 10.6 Error Recovery Flow Diagram

```
Error Occurs
    │
    ▼
┌─────────────────────────────┐
│ Classify Error              │
│ Is it operational?          │
└──────────┬──────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
Operational    Programming Bug
    │             │
    ▼             ▼
┌──────────┐  ┌──────────┐
│ Is it    │  │ Log +    │
│ retryable│  │ Alert    │
└────┬─────┘  └──────────┘
     │
  ┌──┴──┐
  ▼     ▼
 Yes    No
  │     │
  ▼     ▼
┌────┐  ┌──────────┐
│Retry│  │ Return   │
│with │  │ Error    │
│Back │  │ Response │
└──┬──┘  └──────────┘
   │
   ▼
┌──────────┐
│ Success? │
└──┬───┬───┘
   │   │
  Yes  No (exhausted)
   │   │
   ▼   ▼
┌────┐  ┌──────────┐
│Done│  │ Degrade / │
└────┘  │ Fallback  │
        └──────────┘
```

---

## 11. Implementation Checklist

### Phase 1: Foundation
- [ ] Implement `AppError` class with full error code enum
- [ ] Implement global error handler middleware
- [ ] Set up structured JSON logger with log levels
- [ ] Add correlation ID middleware (request tracing)
- [ ] Define standard error response format

### Phase 2: Middleware Integration
- [ ] Integrate error handler into Hono middleware stack
- [ ] Add Zod validation error mapping to standard format
- [ ] Implement rate limit error responses
- [ ] Add auth error normalization (token expired, etc.)
- [ ] Add CORS error handling

### Phase 3: Sentry Setup
- [ ] Configure Sentry DSN in environment variables
- [ ] Initialize Sentry in Worker entry point
- [ ] Add error context enrichment (user, request, environment)
- [ ] Configure error filtering (ignore expected errors)
- [ ] Set up performance tracing for slow queries
- [ ] Add client-side Sentry for Vue app
- [ ] Configure session replays for error debugging

### Phase 4: Logging Infrastructure
- [ ] Structure all log lines as JSON
- [ ] Add request logging middleware (method, path, duration, status)
- [ ] Implement slow query logging (>100ms)
- [ ] Set up Logpush to external service
- [ ] Configure log retention in R2
- [ ] Add sensitive data redaction in logs

### Phase 5: Retry & Recovery
- [ ] Implement retry utility with exponential backoff
- [ ] Configure retry strategies (database, sync, storage)
- [ ] Add gracefull degradation manager
- [ ] Implement circuit breaker pattern for external services
- [ ] Add fallback handlers for degraded services
- [ ] Set up client-side recovery queue

### Phase 6: Alerting
- [ ] Define alert rules (error rate, sync failure, latency)
- [ ] Implement alert evaluation engine
- [ ] Configure Sentry alert rules
- [ ] Add webhook integration (Slack, email)
- [ ] Set up dashboard alerts for admin view
- [ ] Add alert cooldown to prevent notification fatigue

### Phase 7: Debugging
- [ ] Implement health check endpoint
- [ ] Add production debug endpoints (admin-only)
- [ ] Set up request ID tracing through all services
- [ ] Create debug overlay for client-side development
- [ ] Add structured trace spans for complex operations
- [ ] Implement log viewer for recent errors

### Phase 8: Testing
- [ ] Write unit tests for all error classes
- [ ] Test error handler middleware with all error types
- [ ] Test retry logic with mock failures
- [ ] Test circuit breaker open/close/half-open states
- [ ] Test graceful degradation fallbacks
- [ ] Test client-side error handling in Vue components
- [ ] Verify error messages never leak internals in production

---

**Related Documents:**
- [01-security-auth.md](./01-security-auth.md)
- [02-database-schema.md](./02-database-schema.md)
- [03-sync-conflict-resolution.md](./03-sync-conflict-resolution.md)
- [04-testing-strategy.md](./04-testing-strategy.md)

# Deepdive: Sync Mechanism & Conflict Resolution

**Last Updated:** 2026-07-06
**Status:** Final Draft
**Applies To:** Sync endpoints, IndexedDB, Service Worker

---

## Table of Contents

1. [Offline-First Architecture](#1-offline-first-architecture)
2. [Client-Side Data Layer](#2-client-side-data-layer)
3. [Sync Queue Management](#3-sync-queue-management)
4. [Push Sync Protocol](#4-push-sync-protocol)
5. [Pull Sync Protocol](#5-pull-sync-protocol)
6. [Conflict Detection & Resolution](#6-conflict-detection--resolution)
7. [Service Worker Integration](#7-service-worker-integration)
8. [Offline UI/UX Patterns](#8-offline-uiux-patterns)
9. [Testing Sync Scenarios](#9-testing-sync-scenarios)
10. [Monitoring & Observability](#10-monitoring--observability)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. Offline-First Architecture

### 1.1 Core Principle

> **Write to local first. Sync when possible. Resolve conflicts gracefully.**

The app must work fully functional without internet. All writes go to IndexedDB immediately. Background sync handles server synchronization.

### 1.2 Data Flow

```
User Action
    │
    ▼
┌─────────────────┐     ┌─────────────────┐
│    IndexedDB    │     │  Service Worker  │
│  (Local Cache)  │◄────│  (Online Detect) │
│  (Sync Queue)   │     │  (Background Sync)│
└────────┬────────┘     └────────▲────────┘
         │                       │
         ▼                       │
┌─────────────────┐              │
│    API Layer    │──────────────┘
│  /api/sync      │
│  /api/sync/pull │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    D1 Server    │
│   (Source of    │
│    Truth)       │
└─────────────────┘
```

### 1.3 State Machine for Each Record

```
  ┌──────────┐
  │   NEW    │  (Created offline, not yet synced)
  └────┬─────┘
       │
       ▼
  ┌──────────┐      sync success      ┌──────────┐
  │ PENDING  │──────────────────────►│  SYNCED  │
  └────┬─────┘                       └──────────┘
       │
       │ sync conflict
       ▼
  ┌──────────┐      user resolve     ┌──────────┐
  │ CONFLICT │──────────────────────►│  SYNCED  │
  └──────────┘                       └──────────┘
       │
       │ sync failure (retry)
       ▼
  ┌──────────┐
  │ PENDING  │  (Retry with backoff)
  └──────────┘

For modified synced records:
  ┌──────────┐     local edit      ┌──────────┐
  │  SYNCED  │──────────────────►  │ PENDING  │
  └──────────┘                     └──────────┘
```

---

## 2. Client-Side Data Layer

### 2.1 IndexedDB Schema (Dexie.js)

```typescript
// db/local-schema.ts
import Dexie, { type EntityTable } from 'dexie'

interface LocalSantri {
    id: string              // Local UUID (may be replaced by server ID)
    serverId?: string       // Server-assigned ID after sync
    nama_lengkap: string
    jenis_kelamin: 'L' | 'P'
    kelas_id?: string
    angkatan?: string
    tanggal_masuk?: string
    status: 'aktif' | 'lulus' | 'keluar'
    foto_url?: string
    version: number
    created_at: string
    updated_at: string
    // Sync-specific fields
    sync_status: 'synced' | 'pending' | 'conflict'
    sync_error?: string
    last_sync_attempt?: string
    retry_count: number
}

interface LocalCatatanDisiplin {
    id: string
    serverId?: string
    santri_id: string
    tipe: 'pelanggaran' | 'prestasi'
    kategori_id?: string
    judul: string
    deskripsi?: string
    tanggal_kejadian: string
    dicatat_oleh: string
    tindak_lanjut?: string
    version: number
    is_deleted: boolean
    created_at: string
    updated_at: string
    // Sync-specific fields
    sync_status: 'synced' | 'pending' | 'conflict'
    sync_error?: string
    last_sync_attempt?: string
    retry_count: number
}

interface SyncQueueItem {
    id: string
    entity_type: string    // 'santri' | 'catatan_disiplin'
    local_id: string
    action: 'create' | 'update' | 'delete'
    data: string           // JSON serialized
    version: number
    created_at: string
    retry_count: number
    next_retry_at?: string
}

interface SyncConflict {
    id: string
    entity_type: string
    local_id: string
    server_id?: string
    client_version: number
    server_version: number
    client_data: string
    server_data: string
    conflict_type: string
    resolved: boolean
    created_at: string
}

class SantriVoraDB extends Dexie {
    santri!: EntityTable<LocalSantri, 'id'>
    catatan_disiplin!: EntityTable<LocalCatatanDisiplin, 'id'>
    sync_queue!: EntityTable<SyncQueueItem, 'id'>
    sync_conflicts!: EntityTable<SyncConflict, 'id'>
    settings!: Dexie.Table<{ key: string; value: string }, 'key'>

    constructor() {
        super('santrivora')

        this.version(1).stores({
            santri: 'id, sync_status, kelas_id, status, updated_at',
            catatan_disiplin: 'id, sync_status, santri_id, tipe, updated_at',
            sync_queue: 'id, entity_type, next_retry_at, created_at',
            sync_conflicts: 'id, entity_type, resolved, created_at',
            settings: 'key'
        })
    }
}

export const db = new SantriVoraDB()
```

### 2.2 Local ID Strategy

```typescript
// lib/id-gen.ts
// Always generate local IDs as UUID v4
// Map to server IDs after sync

function generateLocalId(): string {
    return crypto.randomUUID()
}

function generateTempSantriId(): string {
    return `local_s_${generateLocalId()}`
}

function generateTempCatatanId(): string {
    return `local_c_${generateLocalId()}`
}
```

---

## 3. Sync Queue Management

### 3.1 Queue Implementation

```typescript
// sync/queue.ts
class SyncQueue {
    private db: SantriVoraDB
    private isSyncing: boolean = false
    private maxRetries: number = 10
    private baseDelay: number = 1000  // 1 second
    private maxDelay: number = 300000 // 5 minutes

    constructor(db: SantriVoraDB) {
        this.db = db
    }

    // Add item to sync queue
    async enqueue(
        entityType: string,
        localId: string,
        action: 'create' | 'update' | 'delete',
        data: Record<string, unknown>,
        version: number
    ): Promise<void> {
        await this.db.sync_queue.add({
            id: generateLocalId(),
            entity_type: entityType,
            local_id: localId,
            action,
            data: JSON.stringify(data),
            version,
            created_at: new Date().toISOString(),
            retry_count: 0
        })

        // Update local record status
        await this.updateLocalSyncStatus(entityType, localId, 'pending')

        // Trigger sync if online
        if (navigator.onLine) {
            this.triggerSync()
        }
    }

    // Process queue
    async processQueue(): Promise<SyncResult> {
        if (this.isSyncing) {
            return { success: true, skipped: true, reason: 'Already syncing' }
        }

        this.isSyncing = true
        const results: SyncItemResult[] = []

        try {
            // Get pending items ordered by creation time
            const pendingItems = await this.db.sync_queue
                .where('next_retry_at')
                .belowOrEqual(new Date().toISOString())
                .or('next_retry_at')
                .equals(undefined)
                .sortBy('created_at')

            for (const item of pendingItems) {
                // Check if we should retry
                if (item.retry_count >= this.maxRetries) {
                    await this.markAsFailed(item)
                    results.push({
                        id: item.id,
                        success: false,
                        error: 'Max retries exceeded'
                    })
                    continue
                }

                const result = await this.processItem(item)

                if (result.success) {
                    await this.removeFromQueue(item)
                } else if (result.conflict) {
                    await this.handleConflict(item, result)
                } else {
                    await this.scheduleRetry(item)
                }

                results.push(result)
            }

            return { success: true, results }
        } catch (err) {
            console.error('[SyncQueue] Error processing queue:', err)
            return { success: false, error: err.message }
        } finally {
            this.isSyncing = false
        }
    }

    // Process a single queue item
    private async processItem(
        item: SyncQueueItem
    ): Promise<SyncItemResult> {
        try {
            const response = await pushSync({
                entity_type: item.entity_type,
                local_id: item.local_id,
                action: item.action,
                data: JSON.parse(item.data),
                version: item.version
            })

            if (response.conflict) {
                return {
                    id: item.id,
                    success: false,
                    conflict: true,
                    serverData: response.serverData,
                    conflictType: response.conflictType
                }
            }

            // Update local ID mapping
            if (response.serverId) {
                await this.updateLocalId(
                    item.entity_type,
                    item.local_id,
                    response.serverId
                )
            }

            // Update local record status to synced
            await this.updateLocalSyncStatus(
                item.entity_type,
                item.local_id,
                'synced'
            )

            return { id: item.id, success: true, serverId: response.serverId }
        } catch (err) {
            return {
                id: item.id,
                success: false,
                error: err.message
            }
        }
    }

    // Schedule retry with exponential backoff
    private async scheduleRetry(item: SyncQueueItem): Promise<void> {
        const delay = Math.min(
            this.baseDelay * Math.pow(2, item.retry_count),
            this.maxDelay
        )

        const nextRetry = new Date(
            Date.now() + delay + Math.random() * 1000  // Add jitter
        )

        await this.db.sync_queue.update(item.id, {
            retry_count: item.retry_count + 1,
            next_retry_at: nextRetry.toISOString(),
            last_sync_attempt: new Date().toISOString()
        })
    }

    // Force trigger sync (called from Service Worker)
    async triggerSync(): Promise<void> {
        if (!navigator.onLine) return

        try {
            await this.processQueue()
            await pullLatestChanges()
        } catch (err) {
            console.error('[SyncQueue] Trigger sync failed:', err)
        }
    }
}

export const syncQueue = new SyncQueue(db)
```

### 3.2 Exponential Backoff Timeline

| Retry | Delay (seconds) | Total Wait |
|---|---|---|
| 1 | 1 | 1s |
| 2 | 2 | 3s |
| 3 | 4 | 7s |
| 4 | 8 | 15s |
| 5 | 16 | 31s |
| 6 | 32 | 63s |
| 7 | 64 | 127s |
| 8 | 128 | 255s |
| 9 | 256 | 511s |
| 10 | 300 | 811s (~13min) |

---

## 4. Push Sync Protocol

### 4.1 API Contract

```typescript
// POST /api/sync
// Request body
interface PushSyncRequest {
    items: Array<{
        entity_type: 'santri' | 'catatan_disiplin'
        local_id: string
        action: 'create' | 'update' | 'delete'
        data: Record<string, unknown>
        version: number   // Client's current version
    }>
}

// Response
interface PushSyncResponse {
    results: Array<{
        local_id: string
        status: 'synced' | 'conflict' | 'error'
        server_id?: string       // Assigned server ID for creates
        server_version?: number  // Updated version
        error?: string
        conflict?: {
            type: 'version_mismatch' | 'deleted_conflict' | 'duplicate_create'
            server_data: Record<string, unknown>
            server_version: number
        }
    }>
}
```

### 4.2 Server-Side Handler

```typescript
// routes/sync.ts
async function handlePushSync(c: Context) {
    const { items } = await c.req.json()
    const user = c.get('user')
    const results: SyncResult[] = []

    for (const item of items) {
        try {
            const result = await processSyncItem(c.env, item, user)
            results.push(result)
        } catch (err) {
            results.push({
                local_id: item.local_id,
                status: 'error',
                error: err.message
            })
        }
    }

    return c.json({ results })
}

async function processSyncItem(
    env: Env,
    item: SyncItem,
    user: User
): Promise<SyncResult> {
    switch (item.entity_type) {
        case 'santri':
            return processSantriSync(env, item, user)
        case 'catatan_disiplin':
            return processCatatanSync(env, item, user)
        default:
            throw new Error(`Unknown entity type: ${item.entity_type}`)
    }
}

async function processSantriSync(
    env: Env,
    item: SyncItem,
    user: User
): Promise<SyncResult> {
    switch (item.action) {
        case 'create': {
            // Check for duplicate (by unique fields)
            const existing = await env.DB.prepare(
                `SELECT id, version, updated_at FROM santri
                 WHERE nama_lengkap = ? AND kelas_id = ?
                 AND tanggal_masuk = ?`
            ).bind(
                item.data.nama_lengkap,
                item.data.kelas_id,
                item.data.tanggal_masuk
            ).first()

            if (existing) {
                // Possible duplicate
                return {
                    local_id: item.local_id,
                    status: 'conflict',
                    conflict: {
                        type: 'duplicate_create',
                        server_data: existing,
                        server_version: existing.version
                    }
                }
            }

            // Create new record
            const newId = crypto.randomUUID()
            await env.DB.prepare(
                `INSERT INTO santri (id, nama_lengkap, jenis_kelamin, kelas_id,
                 angkatan, tanggal_masuk, status, version, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
            ).bind(
                newId,
                item.data.nama_lengkap,
                item.data.jenis_kelamin,
                item.data.kelas_id,
                item.data.angkatan,
                item.data.tanggal_masuk,
                item.data.status || 'aktif'
            ).run()

            // Audit log
            await createAuditLog(env, user.sub, 'santri.create', 'santri', newId, null, item.data)

            return {
                local_id: item.local_id,
                status: 'synced',
                server_id: newId,
                server_version: 1
            }
        }

        case 'update': {
            // Get current server version
            const current = await env.DB.prepare(
                `SELECT id, version, updated_at, status FROM santri
                 WHERE id = ?`
            ).bind(item.data.id).first()

            if (!current) {
                return {
                    local_id: item.local_id,
                    status: 'error',
                    error: 'Record not found on server'
                }
            }

            // Check if the record is soft-deleted
            if (current.status === 'keluar') {
                return {
                    local_id: item.local_id,
                    status: 'conflict',
                    conflict: {
                        type: 'deleted_conflict',
                        server_data: current,
                        server_version: current.version
                    }
                }
            }

            // Check for version conflict
            if (item.version < current.version) {
                // Version mismatch — conflict
                return {
                    local_id: item.local_id,
                    status: 'conflict',
                    conflict: {
                        type: 'version_mismatch',
                        server_data: current,
                        server_version: current.version
                    }
                }
            }

            // Apply update
            const newVersion = current.version + 1
            await env.DB.prepare(
                `UPDATE santri SET
                 nama_lengkap = ?, jenis_kelamin = ?, kelas_id = ?,
                 angkatan = ?, tanggal_masuk = ?, status = ?,
                 version = ?, updated_at = datetime('now')
                 WHERE id = ? AND version = ?`
            ).bind(
                item.data.nama_lengkap,
                item.data.jenis_kelamin,
                item.data.kelas_id,
                item.data.angkatan,
                item.data.tanggal_masuk,
                item.data.status,
                newVersion,
                item.data.id,
                item.version  // Optimistic locking
            ).run()

            // Audit log
            await createAuditLog(env, user.sub, 'santri.update', 'santri', current.id, current, item.data)

            return {
                local_id: item.local_id,
                status: 'synced',
                server_id: current.id,
                server_version: newVersion
            }
        }

        case 'delete': {
            await env.DB.prepare(
                `UPDATE santri SET status = 'keluar',
                 version = version + 1, updated_at = datetime('now')
                 WHERE id = ?`
            ).bind(item.data.id).run()

            await createAuditLog(env, user.sub, 'santri.delete', 'santri', item.data.id, null, null)

            return {
                local_id: item.local_id,
                status: 'synced',
                server_id: item.data.id
            }
        }
    }
}
```

---

## 5. Pull Sync Protocol

### 5.1 API Contract

```typescript
// GET /api/sync/pull?since=timestamp&cursor=xxx
interface PullSyncResponse {
    changes: {
        santri: Array<{
            id: string
            data: Record<string, unknown>
            version: number
            updated_at: string
            action: 'create' | 'update' | 'delete'  // 'delete' if status=keluar
        }>
        catatan_disiplin: Array<{...}>
    }
    cursor: string | null    // Next cursor for pagination
    has_more: boolean
    server_time: string       // Current server time
}
```

### 5.2 Client-Side Pull Handler

```typescript
// sync/pull.ts
async function pullLatestChanges(): Promise<void> {
    let cursor: string | null = null
    const since = getLastSyncTimestamp()

    do {
        const response = await fetchPullSync(since, cursor)

        // Apply changes to local IndexedDB
        await applyPullChanges(response)

        cursor = response.cursor
    } while (cursor)

    // Update last sync timestamp
    await saveLastSyncTimestamp(response.server_time)
}

async function applyPullChanges(
    response: PullSyncResponse
): Promise<void> {
    const tx = db.transaction(
        'rw',
        [db.santri, db.catatan_disiplin],
        async () => {
            // Apply santri changes
            for (const change of response.changes.santri) {
                await applySantriChange(change)
            }

            // Apply catatan changes
            for (const change of response.changes.catatan_disiplin) {
                await applyCatatanChange(change)
            }
        }
    )

    await tx.done
}

async function applySantriChange(
    change: PullChange
): Promise<void> {
    const localRecord = await db.santri.get(change.id)

    if (!localRecord) {
        // New record from server — add to local
        if (change.action !== 'delete') {
            await db.santri.add({
                ...change.data,
                id: change.id,
                serverId: change.id,
                sync_status: 'synced',
                version: change.version
            } as LocalSantri)
        }
        return
    }

    // Check if we have pending local changes
    if (localRecord.sync_status === 'pending') {
        // Local changes exist — check version
        if (change.version > localRecord.version) {
            // Both sides have changes — conflict
            await createLocalConflict({
                entity_type: 'santri',
                local_id: localRecord.id,
                server_id: change.id,
                client_version: localRecord.version,
                server_version: change.version,
                client_data: localRecord,
                server_data: change.data
            })
        }
        return // Don't overwrite pending changes
    }

    // No local pending changes — update from server
    if (change.action === 'delete') {
        await db.santri.update(change.id, {
            status: 'keluar',
            sync_status: 'synced',
            version: change.version
        })
    } else {
        await db.santri.update(change.id, {
            ...change.data,
            sync_status: 'synced',
            version: change.version
        }
    }
}
```

---

## 6. Conflict Detection & Resolution

### 6.1 Conflict Types

| Type | Description | Resolution Strategy |
|---|---|---|
| **version_mismatch** | Client and server edited same record offline | User chooses: use theirs, use ours, or manual merge |
| **deleted_conflict** | Server deleted, client edited (or vice versa) | User decides: keep deleted or restore edit |
| **duplicate_create** | Two clients created "same" record | Server fuzzy-match detection, user merges |

### 6.2 Conflict Detection Algorithm

```typescript
// server: sync/conflict-detection.ts
interface ConflictCheck {
    hasConflict: boolean
    type?: 'version_mismatch' | 'deleted_conflict' | 'duplicate_create'
    serverVersion?: number
    serverData?: Record<string, unknown>
}

async function checkForConflict(
    env: Env,
    entityType: string,
    serverId: string | null,
    clientVersion: number
): Promise<ConflictCheck> {
    if (!serverId) {
        // New record — check for duplicates (for santri)
        // Handled in create flow
        return { hasConflict: false }
    }

    const current = await getServerRecord(env, entityType, serverId)

    if (!current) {
        // Server record not found
        return {
            hasConflict: true,
            type: 'deleted_conflict',
            serverData: null
        }
    }

    // Check soft delete
    if (current.is_deleted || current.status === 'keluar') {
        return {
            hasConflict: true,
            type: 'deleted_conflict',
            serverVersion: current.version,
            serverData: current
        }
    }

    // Check version
    if (current.version > clientVersion) {
        return {
            hasConflict: true,
            type: 'version_mismatch',
            serverVersion: current.version,
            serverData: current
        }
    }

    return { hasConflict: false }
}
```

### 6.3 Conflict Resolution UI Strategy

```typescript
// Client-side conflict resolution
class ConflictResolver {
    async resolveConflict(
        conflict: SyncConflict,
        resolution: 'use_server' | 'use_client' | 'manual_merge',
        mergedData?: Record<string, unknown>
    ): Promise<void> {
        const tx = db.transaction(
            'rw',
            [db.sync_conflicts, db[conflict.entity_type], db.sync_queue],
            async () => {
                switch (resolution) {
                    case 'use_server': {
                        // Apply server data
                        const serverData = JSON.parse(conflict.server_data)
                        await this.applyServerData(
                            conflict.entity_type,
                            conflict.local_id,
                            serverData,
                            conflict.server_version
                        )
                        break
                    }

                    case 'use_client': {
                        // Force push client data
                        const clientData = JSON.parse(conflict.client_data)
                        await this.pushClientData(
                            conflict.entity_type,
                            conflict.server_id || conflict.local_id,
                            clientData
                        )
                        break
                    }

                    case 'manual_merge': {
                        // Apply merged data
                        await this.applyMergedData(
                            conflict.entity_type,
                            conflict.local_id,
                            mergedData
                        )
                        break
                    }
                }

                // Mark conflict as resolved
                await db.sync_conflicts.update(conflict.id, {
                    resolved: true,
                    resolution
                })
            }
        )

        await tx.done
    }

    // Show diff UI for manual merge
    showDiffView(conflict: SyncConflict): DiffData {
        const clientData = JSON.parse(conflict.client_data)
        const serverData = JSON.parse(conflict.server_data)

        const differences: FieldDiff[] = []

        // Compare fields
        for (const key of Object.keys({ ...clientData, ...serverData })) {
            if (key === 'version' || key === 'updated_at') continue

            if (JSON.stringify(clientData[key]) !== JSON.stringify(serverData[key])) {
                differences.push({
                    field: key,
                    clientValue: clientData[key],
                    serverValue: serverData[key]
                })
            }
        }

        return {
            entityType: conflict.entity_type,
            differences
        }
    }
}
```

### 6.4 Auto-Resolve Rules

For specific fields where we can auto-resolve:

```typescript
const AUTO_RESOLVE_RULES: Record<string, AutoResolveStrategy> = {
    // Auto-resolve non-critical fields with last-write-wins
    deskripsi: { strategy: 'last_write_wins' },
    tindak_lanjut: { strategy: 'append', separator: '\n---\n' },

    // Critical fields: always require user decision
    nama_lengkap: { strategy: 'require_user' },
    jenis_kelamin: { strategy: 'require_user' },
    kelas_id: { strategy: 'require_user' },

    // Numeric: take highest
    tingkat_keparahan: { strategy: 'take_highest' },

    // Boolean: merge with OR
    is_active: { strategy: 'merge_or' }
}
```

---

## 7. Service Worker Integration

### 7.1 Service Worker Setup

```typescript
// public/sw.js
const CACHE_NAME = 'santrivora-v1'
const SYNC_INTERVAL = 30000 // 30 seconds

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll([
                '/',
                '/index.html',
                '/app.js',
                '/manifest.json'
            ])
        })
    )
})

self.addEventListener('activate', (event) => {
    // Clean old caches
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            )
        })
    )

    // Start sync interval
    setInterval(() => {
        triggerSync()
    }, SYNC_INTERVAL)
})

// Network-first strategy for API calls
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)

    // API calls: network first, fallback to cache
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(event.request))
        return
    }

    // Static assets: cache first
    event.respondWith(cacheFirst(event.request))
})

async function networkFirst(request: Request): Promise<Response> {
    try {
        const networkResponse = await fetch(request)
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME)
            cache.put(request, networkResponse.clone())
        }
        return networkResponse
    } catch {
        const cachedResponse = await caches.match(request)
        if (cachedResponse) {
            return cachedResponse
        }
        return new Response(JSON.stringify({
            error: 'offline',
            message: 'Anda sedang offline. Data akan disinkronkan otomatis saat online.'
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        })
    }
}

async function cacheFirst(request: Request): Promise<Response> {
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
        return cachedResponse
    }
    return fetch(request)
}

// Background sync
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-santri') {
        event.waitUntil(triggerSync())
    }
})

async function triggerSync() {
    const clients = await self.clients.matchAll()
    for (const client of clients) {
        client.postMessage({
            type: 'SYNC_TRIGGER',
            timestamp: new Date().toISOString()
        })
    }
}

// Listen for pending queue from app
self.addEventListener('message', (event) => {
    if (event.data.type === 'QUEUE_UPDATED') {
        self.registration.sync.register('sync-santri')
    }
})
```

### 7.2 Online/Offline Detection

```typescript
// lib/offline.ts
class OfflineManager {
    private isOnline: boolean = navigator.onLine
    private listeners: Array<(online: boolean) => void> = []

    constructor() {
        window.addEventListener('online', () => this.handleOnline())
        window.addEventListener('offline', () => this.handleOffline())
    }

    private handleOnline() {
        this.isOnline = true
        this.notifyListeners(true)

        // Trigger sync when coming online
        syncQueue.triggerSync()

        // Show notification
        showToast('Koneksi tersambung. Data sedang disinkronkan...')
    }

    private handleOffline() {
        this.isOnline = false
        this.notifyListeners(false)

        // Show notification
        showToast('Koneksi terputus. Perubahan akan disimpan secara lokal.')
    }

    getIsOnline(): boolean {
        return this.isOnline
    }

    onConnectionChange(listener: (online: boolean) => void) {
        this.listeners.push(listener)
    }
}

export const offlineManager = new OfflineManager()
```

---

## 8. Offline UI/UX Patterns

### 8.1 Connection Status Indicator

```typescript
// Vue component
<template>
    <div
        :class="[
            'fixed top-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50',
            online ? 'bg-green-500' : 'bg-yellow-500'
        ]"
    >
        <div class="flex items-center gap-2">
            <div
                :class="[
                    'w-2 h-2 rounded-full',
                    online ? 'bg-white' : 'bg-yellow-200 animate-pulse'
                ]"
            />
            <span class="text-white text-sm font-medium">
                {{ online ? 'Online' : 'Offline' }}
            </span>
        </div>
        <div v-if="!online && pendingCount > 0" class="text-yellow-100 text-xs mt-1">
            {{ pendingCount }} perubahan menunggu sinkronisasi
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { offlineManager } from '@/lib/offline'
import { db } from '@/db/local-schema'

const online = ref(offlineManager.getIsOnline())
const pendingCount = ref(0)

async function updatePendingCount() {
    const count = await db.sync_queue.count()
    pendingCount.value = count
}

onMounted(() => {
    offlineManager.onConnectionChange((status) => {
        online.value = status
    })
    updatePendingCount()
    // Watch for queue changes
    db.sync_queue.hook('creating', updatePendingCount)
    db.sync_queue.hook('deleting', updatePendingCount)
})
</script>
```

### 8.2 Conflict Notification

```typescript
// Auto-show conflict resolution dialog when conflicts detected
const conflicts = ref<SyncConflict[]>([])
const showConflictDialog = ref(false)

async function checkForConflicts() {
    conflicts.value = await db.sync_conflicts
        .where('resolved')
        .equals(0)
        .toArray()

    if (conflicts.value.length > 0) {
        showConflictDialog.value = true
    }
}

// Poll for conflicts periodically
setInterval(checkForConflicts, 30000)
```

### 8.3 Sync Progress Indicator

```typescript
// Show sync progress in header
const syncProgress = ref<{
    status: 'idle' | 'syncing' | 'error'
    progress: { current: number; total: number }
    error?: string
}>()

// Listen for sync events
syncQueue.on('sync-start', () => {
    syncProgress.value = { status: 'syncing', progress: { current: 0, total: 0 } }
})

syncQueue.on('sync-progress', (progress) => {
    syncProgress.value = { status: 'syncing', progress }
})

syncQueue.on('sync-complete', () => {
    syncProgress.value = { status: 'idle', progress: { current: 0, total: 0 } }
})

syncQueue.on('sync-error', (error) => {
    syncProgress.value = { status: 'error', progress: { current: 0, total: 0 }, error }
})
```

---

## 9. Testing Sync Scenarios

### 9.1 Test Categories

```typescript
// tests/sync/scenarios.ts
interface SyncScenario {
    name: string
    description: string
    setup: () => Promise<void>
    execute: () => Promise<void>
    verify: () => Promise<void>
}

const syncScenarios: SyncScenario[] = [
    {
        name: 'create_while_offline',
        description: 'Create santri while offline, verify sync when online',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'update_while_offline',
        description: 'Update existing record offline, sync when online',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'conflict_version_mismatch',
        description: 'Two users edit same record offline, resolve conflict',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'conflict_deleted',
        description: 'User edits record that was deleted by another user',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'sync_queue_persistence',
        description: 'Queue persists across page reloads',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'sync_retry_backoff',
        description: 'Sync retries with exponential backoff on failure',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'pull_changes_from_server',
        description: 'Pull changes made by another user',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'conflict_resolve_use_server',
        description: 'Resolve conflict by using server data',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    },
    {
        name: 'conflict_resolve_use_client',
        description: 'Resolve conflict by using client data',
        setup: async () => { /* ... */ },
        execute: async () => { /* ... */ },
        verify: async () => { /* ... */ }
    }
]
```

### 9.2 Mock Server for Testing

```typescript
// tests/sync/mock-server.ts
class MockSyncServer {
    private data: Map<string, Map<string, Record<string, unknown>>> = new Map()
    private offline: boolean = false
    private failNext: boolean = false

    setOffline(offline: boolean) {
        this.offline = offline
    }

    setFailNext(fail: boolean) {
        this.failNext = fail
    }

    async handlePushSync(request: PushSyncRequest): Promise<PushSyncResponse> {
        if (this.offline) {
            throw new Error('Network error')
        }

        if (this.failNext) {
            this.failNext = false
            throw new Error('Internal server error')
        }

        // Process sync items...
        return { results: [] }
    }
}
```

---

## 10. Monitoring & Observability

### 10.1 Metrics to Track

```typescript
interface SyncMetrics {
    // Success rate
    total_sync_attempts: number
    successful_syncs: number
    failed_syncs: number
    conflict_count: number

    // Performance
    avg_sync_duration_ms: number
    avg_pull_duration_ms: number
    queue_size: number

    // Conflict types
    version_mismatch_count: number
    deleted_conflict_count: number
    duplicate_create_count: number

    // Offline behavior
    total_offline_periods: number
    avg_offline_duration_minutes: number
    total_pending_records: number
}
```

### 10.2 Instrumentation

```typescript
// sync/monitor.ts
class SyncMonitor {
    private metrics: SyncMetrics = {
        total_sync_attempts: 0,
        successful_syncs: 0,
        failed_syncs: 0,
        conflict_count: 0,
        avg_sync_duration_ms: 0,
        avg_pull_duration_ms: 0,
        queue_size: 0,
        version_mismatch_count: 0,
        deleted_conflict_count: 0,
        duplicate_create_count: 0,
        total_offline_periods: 0,
        avg_offline_duration_minutes: 0,
        total_pending_records: 0
    }

    recordSyncAttempt(duration: number, success: boolean, conflict?: boolean) {
        this.metrics.total_sync_attempts++
        if (success) {
            this.metrics.successful_syncs++
        } else if (conflict) {
            this.metrics.conflict_count++
        } else {
            this.metrics.failed_syncs++
        }

        // Moving average
        this.metrics.avg_sync_duration_ms =
            (this.metrics.avg_sync_duration_ms * (this.metrics.total_sync_attempts - 1) + duration)
            / this.metrics.total_sync_attempts

        // Send to analytics
        this.flushMetrics()
    }

    private async flushMetrics() {
        // Send to Cloudflare Analytics or your monitoring service
        try {
            await fetch('/api/metrics', {
                method: 'POST',
                body: JSON.stringify(this.metrics)
            })
        } catch {
            // Fail silently — metrics should not affect app
        }
    }
}
```

---

## 11. Implementation Checklist

### Phase 1: Local Database
- [ ] Set up Dexie.js with full schema
- [ ] Implement CRUD operations for IndexedDB
- [ ] Add sync_status field tracking
- [ ] Implement local ID generation
- [ ] Write data access layer (queries, filters, pagination)

### Phase 2: Sync Queue
- [ ] Implement queue enqueue/dequeue
- [ ] Implement exponential backoff
- [ ] Implement queue persistence
- [ ] Add retry limit and error handling
- [ ] Implement queue priority ordering

### Phase 3: Push Sync
- [ ] Implement POST /api/sync endpoint
- [ ] Implement server-side create/update/delete handlers
- [ ] Implement version checking
- [ ] Add optimistic locking (UPDATE WHERE version=?)
- [ ] Implement scoping validation (ustadz can only sync their kelas)

### Phase 4: Pull Sync
- [ ] Implement GET /api/sync/pull endpoint
- [ ] Implement cursor-based pagination
- [ ] Implement client-side merge logic
- [ ] Handle pending local changes during pull
- [ ] Implement incremental sync (since timestamp)

### Phase 5: Conflict Resolution
- [ ] Implement conflict detection (version, deleted, duplicate)
- [ ] Implement conflict storage (sync_conflicts table)
- [ ] Build conflict resolution UI (diff viewer)
- [ ] Implement resolution strategies (use server/client/merge)
- [ ] Add auto-resolve rules for non-critical fields

### Phase 6: Service Worker
- [ ] Register Service Worker
- [ ] Implement cache strategies (network-first API, cache-first assets)
- [ ] Implement background sync
- [ ] Handle offline fetch interception
- [ ] Add message passing between SW and app

### Phase 7: UI/UX
- [ ] Connection status indicator
- [ ] Sync progress indicator
- [ ] Conflict notification dialog
- [ ] Offline warning toasts
- [ ] Pending changes indicator (badge + count)

### Phase 8: Testing
- [ ] Write sync scenario tests
- [ ] Test conflict resolution flows
- [ ] Test offline creation sync
- [ ] Test pull change application
- [ ] Test sync queue persistence
- [ ] Test concurrent edit conflicts

---

**Related Documents:**
- [02-database-schema.md](./02-database-schema.md)
- [04-testing-strategy.md](./04-testing-strategy.md)
- [05-error-handling-logging.md](./05-error-handling-logging.md)

import { ref } from 'vue'
import api from '@/services/api'
import { db } from '../db'
import { pullableEntities } from '../registry'

const SINCE_KEY = 'sync_since'
const EPOCH = '1970-01-01T00:00:00.000Z'
const PAGE_LIMIT = 200

function getSince(): string {
  return localStorage.getItem(SINCE_KEY) ?? EPOCH
}

/** Reaktif — dipakai SyncStatusIndicator buat nampilin "terakhir sync
 * <waktu>". Diseed dari localStorage biar tetap kelihatan benar setelah
 * reload (bukan balik ke null). */
export const lastSyncAt = ref<string | null>(localStorage.getItem(SINCE_KEY))

function setSince(value: string): void {
  localStorage.setItem(SINCE_KEY, value)
  lastSyncAt.value = value
}

interface PullResponse {
  changes: Record<string, Record<string, unknown>[]>
  has_more: boolean
  server_time: string
  [cursorKey: string]: unknown
}

let pulling: Promise<void> | null = null

/**
 * Tarik SEMUA entity pullable dalam satu window `since` yang sama (backend
 * `/api/sync/pull` memang men-generate changes utk semua entity terdaftar
 * sekaligus per panggilan, bukan per-entity) — loop pakai cursor_<entityType>
 * sampai has_more habis, baru majukan watermark `since` global ke
 * server_time respons TERAKHIR dan reset semua cursor buat window berikutnya.
 */
export function pullAll(): Promise<void> {
  if (pulling) return pulling
  pulling = runPull().finally(() => {
    pulling = null
  })
  return pulling
}

async function runPull(): Promise<void> {
  const types = pullableEntities().map((c) => c.entityType)
  if (types.length === 0) return

  let hasMore = true
  while (hasMore) {
    const since = getSince()
    const metas = await db.syncMeta.toArray()
    const cursorMap = new Map(metas.map((m) => [m.entityType, m.cursor]))

    const params: Record<string, string | number> = { since, limit: PAGE_LIMIT }
    for (const t of types) {
      const cursor = cursorMap.get(t)
      if (cursor) params[`cursor_${t}`] = cursor
    }

    const res = await api.get('/sync/pull', { params })
    const body = res.data as PullResponse

    await db.transaction('rw', db.tables, async () => {
      for (const t of types) {
        const rows = body.changes[t] ?? []
        if (rows.length > 0) await db.table(t).bulkPut(rows)
        const nextCursor = (body[`cursor_${t}`] as string | null) ?? null
        await db.syncMeta.put({ entityType: t, cursor: nextCursor })
      }
    })

    hasMore = body.has_more
    if (!hasMore) {
      setSince(body.server_time)
      await db.syncMeta.clear()
    }
  }
}

import { ref } from 'vue'
import api from '@/services/api'
import { db } from '../db'
import { pullableEntities } from '../registry'

const SINCE_KEY = 'sync_since'
// Format watermark WAJIB sama persis dengan format `updated_at` di DB, yaitu
// keluaran SQLite `datetime('now')`: 'YYYY-MM-DD HH:MM:SS' (UTC, pakai SPASI).
// Query pull membandingkannya sebagai STRING, jadi beda format = perbandingan
// ngaco. Lihat penjelasan lengkapnya di processPull (src/lib/sync/engine.ts).
const EPOCH = '1970-01-01 00:00:00'
const PAGE_LIMIT = 200

/** Watermark versi lama (ISO, mengandung 'T') yang mungkin masih tersimpan di
 * localStorage HP staff dari sebelum perbaikan format. Dibandingkan dengan
 * `updated_at` bergaya SQLite, nilai seperti itu SELALU menang secara string
 * untuk hari yang sama — artinya device itu bakal terus buta terhadap data
 * baru sampai lewat tengah malam UTC. Diperlakukan sebagai "belum pernah
 * sync" supaya tiap device sembuh sendiri lewat satu kali resync penuh, tanpa
 * perlu menyuruh staff clear site data satu per satu. */
function isLegacyIsoWatermark(value: string): boolean {
  return value.includes('T')
}

function getSince(): string {
  const raw = localStorage.getItem(SINCE_KEY)
  if (!raw || isLegacyIsoWatermark(raw)) return EPOCH
  return raw
}

/** Reaktif — dipakai SyncStatusIndicator buat nampilin "terakhir sync
 * <waktu>". Diseed dari localStorage biar tetap kelihatan benar setelah
 * reload (bukan balik ke null). Watermark format lama diabaikan di sini juga,
 * biar labelnya gak nampilin waktu yang sebenarnya sudah tidak dipakai. */
function seedLastSync(): string | null {
  const raw = localStorage.getItem(SINCE_KEY)
  return raw && !isLegacyIsoWatermark(raw) ? raw : null
}

export const lastSyncAt = ref<string | null>(seedLastSync())

/**
 * Ubah watermark ('YYYY-MM-DD HH:MM:SS', UTC) jadi Date yang benar.
 *
 * WAJIB lewat sini, jangan `new Date(watermark)` langsung: string tanpa 'T'
 * dan tanpa 'Z' diperlakukan JS sebagai waktu LOKAL, padahal nilainya UTC —
 * di WIB (UTC+7) labelnya bakal meleset 7 jam ("7 jam lalu" padahal barusan).
 */
export function parseSyncTimestamp(value: string): Date {
  return new Date(value.replace(' ', 'T') + 'Z')
}

function setSince(value: string): void {
  localStorage.setItem(SINCE_KEY, value)
  lastSyncAt.value = value
}

/** Buang watermark supaya pull berikutnya mulai dari EPOCH (full resync).
 * Dipanggil dari offline/reset.ts — lihat penjelasan lengkapnya di sana. */
export function clearSince(): void {
  localStorage.removeItem(SINCE_KEY)
  lastSyncAt.value = null
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

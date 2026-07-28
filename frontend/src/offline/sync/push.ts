import api from '@/services/api'
import { db, type OutboxItem } from '../db'
import { getEntityConfig } from '../registry'
import { recordConflict } from './conflicts'

const BATCH_SIZE = 100
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000] // 5s,15s,60s,5m,15m(cap)

interface PushResult {
  local_id: string
  status: 'synced' | 'conflict' | 'error'
  server_id?: string
  server_version?: number
  error?: string
  conflict?: { type: string; server_data: Record<string, unknown>; server_version: number }
}

let flushing: Promise<void> | null = null

/**
 * Kirim semua outbox item yang 'pending' ATAU 'error' yang backoff-nya sudah
 * lewat, batch sampai BATCH_SIZE (limit backend) per panggilan /api/sync,
 * ulang sampai outbox yang due habis. Ada guard in-flight — panggilan
 * bertumpuk (dari requestPush debounce + online listener + interval) cukup
 * nunggu flush yang lagi jalan, bukan jalan dobel.
 */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing
  flushing = runFlush().finally(() => {
    flushing = null
  })
  return flushing
}

async function runFlush(): Promise<void> {
  for (;;) {
    const now = new Date().toISOString()
    const all = await db.outbox.toArray()
    const due = all.filter((item) => item.status === 'pending' || (item.status === 'error' && (!item.nextRetryAt || item.nextRetryAt <= now)))
    if (due.length === 0) return

    const batch = due.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, BATCH_SIZE)
    const payload = {
      items: batch.map((item) => ({
        entity_type: item.entityType,
        local_id: String(item.id),
        action: item.action,
        data: item.data,
        version: item.version
      }))
    }

    let results: PushResult[]
    try {
      const res = await api.post('/sync', payload)
      results = res.data.results as PushResult[]
    } catch {
      // Gagal network (offline/timeout) — biarkan semua item apa adanya,
      // coba lagi nanti lewat listener 'online' / interval berkala.
      return
    }

    await applyResults(batch, results)
    // Loop lagi buat re-scan outbox (batch berikutnya kalau `due` masih
    // menyisakan lebih dari BATCH_SIZE) — keluar sendiri begitu due.length
    // jadi 0 di iterasi berikutnya.
  }
}

async function applyResults(batch: OutboxItem[], results: PushResult[]): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const item of batch) {
      const result = results.find((r) => r.local_id === String(item.id))
      if (!result) continue // seharusnya gak terjadi (backend selalu 1:1), jaga-jaga aja
      const config = getEntityConfig(item.entityType)
      const table = db.table(item.entityType)

      if (result.status === 'synced') {
        await db.outbox.delete(item.id!)
        if (item.action === 'delete') {
          if (config?.softDelete) {
            await table.update(item.localId, { [config.softDelete.column]: config.softDelete.setValue, version: result.server_version })
          } else {
            await table.delete(item.localId)
          }
        } else {
          const cached = await table.get(item.localId)
          if (cached) await table.update(item.localId, { version: result.server_version ?? cached.version })
        }
      } else if (result.status === 'conflict') {
        await recordConflict({
          entityType: item.entityType,
          localId: item.localId,
          action: item.action,
          clientData: item.data,
          serverData: result.conflict?.server_data ?? {},
          serverVersion: result.conflict?.server_version ?? 0,
          detectedAt: new Date().toISOString()
        })
        await db.outbox.delete(item.id!)
      } else {
        const attempts = item.attempts + 1
        const backoffMs = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
        await db.outbox.update(item.id!, {
          status: 'error',
          attempts,
          lastError: result.error,
          nextRetryAt: new Date(Date.now() + backoffMs).toISOString()
        })
      }
    }
  })
}

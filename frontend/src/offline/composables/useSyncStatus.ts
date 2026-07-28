import { ref, onBeforeUnmount } from 'vue'
import { liveQuery } from 'dexie'
import { db } from '../db'
import { pullAll, flushOutbox, lastSyncAt } from '../sync/engine'

/** Status sync global, dipakai SyncStatusIndicator.vue (topbar) — semua
 * angkanya dari cache Dexie LOKAL (offline-safe, instan, gak perlu network
 * sama sekali buat sekadar nampilin badge). */
export function useSyncStatus() {
  const isOnline = ref(navigator.onLine)
  const handleOnline = () => { isOnline.value = true }
  const handleOffline = () => { isOnline.value = false }
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  const pendingCount = ref(0)
  const errorCount = ref(0)
  const conflictCount = ref(0)

  const outboxSub = liveQuery(() => db.outbox.toArray()).subscribe({
    next: (items) => {
      pendingCount.value = items.filter((i) => i.status === 'pending').length
      errorCount.value = items.filter((i) => i.status === 'error').length
    },
    error: () => {}
  })
  const conflictsSub = liveQuery(() => db.conflicts.count()).subscribe({
    next: (count) => { conflictCount.value = count },
    error: () => {}
  })

  onBeforeUnmount(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    outboxSub.unsubscribe()
    conflictsSub.unsubscribe()
  })

  const syncing = ref(false)
  async function syncNow(): Promise<void> {
    syncing.value = true
    try {
      await Promise.all([pullAll(), flushOutbox()])
    } finally {
      syncing.value = false
    }
  }

  return { isOnline, pendingCount, errorCount, conflictCount, lastSyncAt, syncing, syncNow }
}

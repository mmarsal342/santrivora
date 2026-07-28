import { liveQuery } from 'dexie'
import { ref, watch, isRef, onBeforeUnmount, type Ref } from 'vue'
import { db } from '../db'

/** Ambil satu baris entity dari cache Dexie, reaktif (liveQuery) — otomatis
 * update kalau baris itu berubah lewat pull ATAU mutasi lokal manapun. */
export function useEntityDetail<T>(
  entityType: string,
  id: Ref<string | undefined> | string
) {
  const table = db.table(entityType)
  const item = ref<T | null>(null)
  const loading = ref(true)

  const idRef = isRef(id) ? id : ref(id)
  let subscription: { unsubscribe: () => void } | null = null

  function resubscribe(currentId: string | undefined): void {
    subscription?.unsubscribe()
    if (!currentId) {
      item.value = null
      loading.value = false
      return
    }
    loading.value = true
    subscription = liveQuery(() => table.get(currentId)).subscribe({
      next: (row) => {
        item.value = (row as T) ?? null
        loading.value = false
      },
      error: (err) => {
        console.error(`[useEntityDetail:${entityType}]`, err)
        loading.value = false
      }
    })
  }

  watch(idRef, (v) => resubscribe(v), { immediate: true })
  onBeforeUnmount(() => subscription?.unsubscribe())

  return { item, loading }
}

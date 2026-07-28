import { liveQuery } from 'dexie'
import { ref, shallowRef, computed, onBeforeUnmount } from 'vue'
import { db } from '../db'
import { pullAll } from '../sync/engine'

export interface UseEntityListOptions<T> {
  /** Dipanggil di dalam computed internal — kalau closure-nya baca ref Vue
   * reaktif lain (search, filter dropdown, dst), computed ini otomatis
   * ke-track ulang tiap ref itu berubah, PERSIS seperti computed biasa. */
  filter?: (row: T) => boolean
  sort?: (a: T, b: T) => number
  pageSize?: number
}

/**
 * Baca entity dari cache Dexie (instan, `loading` cuma true kalau cache
 * masih kosong) sambil pullAll() jalan di background TANPA nge-block
 * (stale-while-revalidate). "Load more" = window paginasi LOKAL di atas data
 * yang sudah lengkap ke-cache — beda dari cursor pull-sync (urusan server,
 * lihat offline/sync/pull.ts), sengaja dipisah biar gak ketuker.
 */
export function useEntityList<T>(
  entityType: string,
  options: UseEntityListOptions<T> = {}
) {
  const pageSize = options.pageSize ?? 20
  const visibleCount = ref(pageSize)
  const rawItems = shallowRef<T[]>([])
  const loading = ref(true)
  const error = ref('')

  const table = db.table(entityType)
  const subscription = liveQuery(() => table.toArray()).subscribe({
    next: (rows) => {
      rawItems.value = rows as T[]
      loading.value = false
    },
    error: (err) => {
      console.error(`[useEntityList:${entityType}]`, err)
      error.value = String(err)
      loading.value = false
    }
  })
  onBeforeUnmount(() => subscription.unsubscribe())

  const filteredSorted = computed(() => {
    let list = rawItems.value
    if (options.filter) list = list.filter(options.filter)
    if (options.sort) list = [...list].sort(options.sort)
    return list
  })

  const items = computed(() => filteredSorted.value.slice(0, visibleCount.value))
  const total = computed(() => filteredSorted.value.length)
  const hasMoreLocal = computed(() => filteredSorted.value.length > visibleCount.value)

  function loadMore(): void {
    visibleCount.value += pageSize
  }

  /** Panggil ini saat filter berubah — biar "load more" mulai dari halaman
   * pertama lagi utk hasil filter yang baru (mirror reset cursor lama). */
  function resetWindow(): void {
    visibleCount.value = pageSize
  }

  pullAll().catch(() => {})

  return { items, allItems: rawItems, total, loading, error, hasMoreLocal, loadMore, resetWindow }
}

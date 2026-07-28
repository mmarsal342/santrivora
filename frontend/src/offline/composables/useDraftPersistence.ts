import { ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { db } from '../db'

const AUTOSAVE_DEBOUNCE_MS = 1500

/**
 * Autosave draft form ke IndexedDB, generik buat form APA PUN — bukan cuma
 * mitigasi buat sesi yang gagal refresh token, tapi pelindung dari interupsi
 * apa pun (tab ke-close, laptop mati, dst). Panggil dengan key unik per form
 * (contoh: `santri-form:${route.params.id ?? 'new'}`).
 *
 * Composable ini CUMA mendeteksi + menyimpan/memulihkan — tidak memutuskan
 * kapan draft diterapkan ke form (itu keputusan view, lewat restoreDraft()),
 * supaya view bisa pilih auto-restore langsung atau tampilkan notice dulu.
 */
export function useDraftPersistence<T extends Record<string, unknown>>(
  draftKey: string,
  formState: Ref<T>
): { hasDraft: Ref<boolean>; restoreDraft: () => Promise<void>; clearDraft: () => Promise<void> } {
  const hasDraft = ref(false)
  let savedDraftData: T | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  db.drafts.get(draftKey).then((record) => {
    if (record) {
      savedDraftData = record.data as T
      hasDraft.value = true
    }
  })

  async function restoreDraft(): Promise<void> {
    if (!savedDraftData) return
    formState.value = { ...formState.value, ...savedDraftData }
  }

  async function clearDraft(): Promise<void> {
    await db.drafts.delete(draftKey)
    savedDraftData = null
    hasDraft.value = false
  }

  const stopWatch = watch(
    formState,
    (value) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        db.drafts.put({ draftKey, data: JSON.parse(JSON.stringify(value)), updatedAt: new Date().toISOString() })
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    { deep: true }
  )

  onBeforeUnmount(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    stopWatch()
  })

  return { hasDraft, restoreDraft, clearDraft }
}

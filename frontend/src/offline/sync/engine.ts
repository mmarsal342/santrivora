import { flushOutbox } from './push'
import { pullAll } from './pull'

const PUSH_DEBOUNCE_MS = 1200
const PULL_INTERVAL_MS = 5 * 60 * 1000

let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** Dipanggil tiap kali useEntityMutation nulis mutasi baru ke outbox —
 * debounced supaya beberapa aksi beruntun (mis. edit cepat berkali-kali)
 * numpuk jadi satu flush, bukan satu request per aksi. */
export function requestPush(): void {
  if (pushDebounceTimer) clearTimeout(pushDebounceTimer)
  pushDebounceTimer = setTimeout(() => {
    flushOutbox().catch(() => {})
  }, PUSH_DEBOUNCE_MS)
}

function isAuthenticated(): boolean {
  // Sengaja baca langsung dari localStorage (bukan Pinia store) — sama
  // seperti services/api.ts, biar sync engine berdiri sendiri tanpa gantung
  // ke store manapun (hindari circular import antara stores/auth.ts <->
  // offline/sync).
  return !!localStorage.getItem('access_token')
}

function ifAuthed(fn: () => void): void {
  if (isAuthenticated()) fn()
}

let initialized = false

/**
 * Pasang listener latar belakang SEKALI per app-load: online -> flush+pull
 * langsung, tab kembali aktif -> pull, timer berkala tiap 5 menit selagi
 * online -> pull+flush jaga-jaga. Aman dipanggil walau belum login (semua
 * aksi di-guard `ifAuthed`, gak ada request nyasar ke halaman publik).
 */
export function initSyncEngine(): void {
  if (initialized) return
  initialized = true

  ifAuthed(() => {
    pullAll().catch(() => {})
    flushOutbox().catch(() => {})
  })

  window.addEventListener('online', () => {
    ifAuthed(() => {
      flushOutbox().catch(() => {})
      pullAll().catch(() => {})
    })
  })

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ifAuthed(() => pullAll().catch(() => {}))
  })

  setInterval(() => {
    ifAuthed(() => {
      pullAll().catch(() => {})
      flushOutbox().catch(() => {})
    })
  }, PULL_INTERVAL_MS)
}

export { flushOutbox, pullAll }

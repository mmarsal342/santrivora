import { reactive } from 'vue'

export interface ToastMessage {
  id: number
  text: string
  variant: 'info' | 'warning'
}

const state = reactive<{ messages: ToastMessage[] }>({ messages: [] })
let nextId = 0

/** Toast global minimal — dipakai buat notifikasi non-blocking generik
 * (contoh pertama: reconciliation akses/role berubah selagi offline, lihat
 * router/index.ts). Bukan sistem notifikasi berat, cuma pesan singkat yang
 * hilang sendiri. */
export function useToast() {
  function show(text: string, variant: ToastMessage['variant'] = 'info', durationMs = 5000): void {
    const id = ++nextId
    state.messages.push({ id, text, variant })
    setTimeout(() => {
      const idx = state.messages.findIndex((m) => m.id === id)
      if (idx !== -1) state.messages.splice(idx, 1)
    }, durationMs)
  }

  function dismiss(id: number): void {
    const idx = state.messages.findIndex((m) => m.id === id)
    if (idx !== -1) state.messages.splice(idx, 1)
  }

  return { messages: state.messages, show, dismiss }
}

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services'
import { pullAll, flushOutbox } from '@/offline/sync/engine'
import { resetReadCache, resetAllOfflineData, getCacheOwner, setCacheOwner } from '@/offline/reset'

interface User {
  id: string
  email: string
  nama_lengkap: string
  role: 'admin' | 'ustadz' | 'kyai' | 'kepala_asrama'
  asrama_jenis?: 'L' | 'P' | null
  status: string
  kelas_ids: string[]
  assigned_kelas?: Array<{ id: string; nama: string; tingkatan: string; tahun_ajaran: string }>
  kamar_ids: string[]
  assigned_kamar?: Array<{ id: string; nama: string; jenis_kelamin: 'L' | 'P'; kapasitas?: number }>
}

function loadCachedUser(): User | null {
  const raw = localStorage.getItem('cached_user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  // Diseed dari cache biar shell app (sidebar/topbar/role-gate) bisa render
  // INSTAN begitu app dibuka, tanpa nunggu network — fetchMe() di router
  // jalan di background buat rekonsiliasi (lihat router/index.ts).
  const user = ref<User | null>(loadCachedUser())
  const token = ref<string | null>(localStorage.getItem('access_token'))
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isUstadz = computed(() => user.value?.role === 'ustadz')
  const isKyai = computed(() => user.value?.role === 'kyai')
  const isKepalaAsrama = computed(() => user.value?.role === 'kepala_asrama')
  const isReadOnly = computed(() => user.value?.role === 'kyai')
  /** Peran dengan akses luas (admin, kyai, kepala_asrama) — bukan ustadz biasa */
  const isPrivileged = computed(() => ['admin', 'kyai', 'kepala_asrama'].includes(user.value?.role || ''))
  const asramaJenis = computed(() => user.value?.asrama_jenis ?? null)
  const asramaLabel = computed(() => {
    if (user.value?.asrama_jenis === 'L') return 'Putra'
    if (user.value?.asrama_jenis === 'P') return 'Putri'
    return null
  })

  async function login(email: string, password: string) {
    loading.value = true
    try {
      const data = await authService.login(email, password)
      token.value = data.access_token
      user.value = data.user
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      localStorage.setItem('cached_user', JSON.stringify(data.user))

      // Cache baca SELALU dibuang saat login, tanpa syarat. Ini disengaja dan
      // penting: login adalah satu-satunya titik di mana kita bisa menjamin
      // sesi dimulai dari state yang bersih & sesuai scope terbaru.
      //
      // Kenapa gak cukup mengandalkan pembersihan di logout(): sesi sebelumnya
      // bisa berakhir lewat jalur yang TIDAK melewati logout() sama sekali —
      // yaitu saat refresh token ditolak (services/api.ts menghapus token
      // langsung lalu hard-redirect ke /login). Dan itu justru jalur yang
      // dilewati user yang baru diubah role-nya, karena assign-role me-revoke
      // semua sesinya (admin.ts). Kalau watermark `since` yang basi lolos dari
      // situ, pull berikutnya cuma minta "yang berubah sejak watermark lama" —
      // sementara data yang baru jadi kelihatan karena scope melebar justru
      // TIDAK berubah sejak saat itu, jadi selamanya gak pernah dikirim.
      //
      // Selain itu, scope user bisa saja diubah admin selagi dia logout — dan
      // dari sini kita gak punya cara tahu itu terjadi. Resync penuh sekali per
      // login jauh lebih murah daripada salah data.
      const previousOwner = getCacheOwner()
      if (previousOwner && previousOwner !== data.user.id) {
        // Device ganti pemilik: buang SEMUA, termasuk outbox/drafts milik akun
        // sebelumnya yang gak boleh ke-push atas nama akun ini (lihat
        // offline/reset.ts). Sekalian menutup kebocoran cache antar-user.
        const discarded = await resetAllOfflineData().catch(() => 0)
        if (discarded > 0) {
          console.warn(
            `[offline] ${discarded} perubahan offline milik akun sebelumnya di device ini dibuang — gak bisa dikirim atas nama akun yang sekarang.`
          )
        }
      } else {
        // Akun yang sama: cukup cache baca. outbox/drafts/conflicts miliknya
        // sendiri DIPERTAHANKAN supaya kerjaan offline yang belum terkirim gak
        // hilang cuma karena dia login ulang.
        await resetReadCache().catch(() => {})
      }
      setCacheOwner(data.user.id)

      // Pull sekali saat login (bukan cuma nunggu listener berkala di
      // initSyncEngine, yang mungkin sudah lewat kick awalnya sebelum token
      // ini ada) + flush jaga-jaga kalau ada outbox nyangkut dari sesi lain.
      pullAll().catch(() => {})
      flushOutbox().catch(() => {})
      return data
    } finally {
      loading.value = false
    }
  }

  /**
   * `background: true` dipakai router pas auth.user sudah keisi dari cache
   * (bukan blocking cold-start) — kalau gagal karena OFFLINE (bukan server
   * benar-benar menolak), sesi ter-cache TETAP dipakai, tidak logout paksa.
   * Ini yang bikin app tetap bisa dibuka read-only offline walau reconciliation
   * background-nya gagal karena gak ada koneksi.
   */
  async function fetchMe(opts: { background?: boolean } = {}) {
    if (!token.value) return null
    const before = user.value
    try {
      const data = await authService.getMe()
      user.value = data
      localStorage.setItem('cached_user', JSON.stringify(data))

      // Scope user berubah di server (admin ganti role / asrama / ini device
      // akun lain)? Cache baca yang ada sudah basi DAN watermark `since`-nya
      // bikin data yang baru jadi kelihatan gak akan pernah ke-pull. Buang
      // cache-nya lalu tarik ulang penuh — ini inti perbaikan bug "dipromote
      // jadi kepala asrama tapi semua layar kosong".
      const scopeChanged =
        !!before &&
        (before.id !== data.id || before.role !== data.role || (before.asrama_jenis ?? null) !== (data.asrama_jenis ?? null))
      if (scopeChanged) {
        await resetReadCache().catch(() => {})
        pullAll().catch(() => {})
      }
      return data
    } catch (err) {
      const hasServerResponse = !!(err as { response?: unknown })?.response
      if (hasServerResponse || !opts.background) await logout()
      return null
    }
  }

  async function logout() {
    // Coba kirim dulu apa pun yang masih nyangkut di outbox SELAGI token masih
    // valid — api.ts baca token dari localStorage tiap request, jadi ini WAJIB
    // sebelum localStorage dibersihkan di bawah, bukan sesudahnya.
    if (token.value && navigator.onLine) {
      await flushOutbox().catch(() => {})
    }
    if (token.value) {
      authService.logout().catch(() => {})
    }
    token.value = null
    user.value = null
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('cached_user')
    // Cache BACA dibuang (termasuk watermark `since`) supaya login berikutnya —
    // siapa pun dan dengan scope apa pun — mulai dari resync penuh. outbox/
    // drafts/conflicts DIPERTAHANKAN: kalau user yang sama login lagi, kerjaan
    // offline-nya yang belum terkirim masih utuh. `sync_owner` juga sengaja
    // TIDAK dihapus — itu yang dipakai login berikutnya buat tahu device ini
    // ganti pemilik atau bukan.
    await resetReadCache().catch(() => {})
  }

  return {
    user,
    token,
    loading,
    isAuthenticated,
    isAdmin,
    isUstadz,
    isKyai,
    isKepalaAsrama,
    isReadOnly,
    isPrivileged,
    asramaJenis,
    asramaLabel,
    login,
    fetchMe,
    logout
  }
})
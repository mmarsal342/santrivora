import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services'

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
    try {
      const data = await authService.getMe()
      user.value = data
      localStorage.setItem('cached_user', JSON.stringify(data))
      return data
    } catch (err) {
      const hasServerResponse = !!(err as { response?: unknown })?.response
      if (hasServerResponse || !opts.background) logout()
      return null
    }
  }

  function logout() {
    if (token.value) {
      authService.logout().catch(() => {})
    }
    token.value = null
    user.value = null
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('cached_user')
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
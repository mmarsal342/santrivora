import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services'

interface User {
  id: string
  email: string
  nama_lengkap: string
  role: 'admin' | 'ustadz'
  status: string
  kelas_ids: string[]
  assigned_kelas?: Array<{ id: string; nama: string; tingkatan: string; tahun_ajaran: string }>
  kamar_ids: string[]
  assigned_kamar?: Array<{ id: string; nama: string; jenis_kelamin: 'L' | 'P'; kapasitas?: number }>
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('access_token'))
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isUstadz = computed(() => user.value?.role === 'ustadz')

  async function login(email: string, password: string) {
    loading.value = true
    try {
      const data = await authService.login(email, password)
      token.value = data.access_token
      user.value = data.user
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      return data
    } finally {
      loading.value = false
    }
  }

  async function fetchMe() {
    if (!token.value) return null
    try {
      const data = await authService.getMe()
      user.value = data
      return data
    } catch {
      logout()
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
  }

  return {
    user,
    token,
    loading,
    isAuthenticated,
    isAdmin,
    isUstadz,
    login,
    fetchMe,
    logout
  }
})
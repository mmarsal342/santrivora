<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { authService } from '@/services'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const form = reactive({
  current_password: '',
  new_password: '',
  confirm_password: ''
})
const submitting = ref(false)
const success = ref('')
const error = ref('')

const passwordRules: Array<{ label: string; test: (v: string) => boolean }> = [
  { label: 'Minimal 8 karakter', test: (v) => v.length >= 8 },
  { label: 'Huruf kapital', test: (v) => /[A-Z]/.test(v) },
  { label: 'Huruf kecil', test: (v) => /[a-z]/.test(v) },
  { label: 'Angka', test: (v) => /\d/.test(v) },
  { label: 'Karakter spesial', test: (v) => /[^A-Za-z0-9]/.test(v) },
]

const passedRules = computed(() => passwordRules.filter(r => r.test(form.new_password)).length)
const strengthScore = computed(() => {
  if (!form.new_password) return 0
  return passedRules.value
})
const strengthLabel = computed(() => {
  const s = strengthScore.value
  if (s === 0) return ''
  if (s <= 2) return 'Lemah'
  if (s <= 3) return 'Sedang'
  if (s === 4) return 'Kuat'
  return 'Sangat Kuat'
})
const strengthColor = computed(() => {
  const s = strengthScore.value
  if (s <= 2) return 'bg-rose-500'
  if (s <= 3) return 'bg-amber-500'
  if (s === 4) return 'bg-lime-500'
  return 'bg-emerald-500'
})
const strengthTextClass = computed(() => {
  const s = strengthScore.value
  if (s <= 2) return 'text-rose-600'
  if (s <= 3) return 'text-amber-600'
  if (s === 4) return 'text-lime-600'
  return 'text-emerald-600'
})
const passwordErrors = computed(() => strengthScore.value < 5 && form.new_password.length > 0 ? [passwordRules[strengthScore.value].label] : [])

function avatarColor(nama: string): string {
  const colors = [
    'bg-emerald-100 text-emerald-700',
    'bg-sky-100 text-sky-700',
    'bg-violet-100 text-violet-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-teal-100 text-teal-700',
    'bg-indigo-100 text-indigo-700',
    'bg-pink-100 text-pink-700',
  ]
  let hash = 0
  for (let i = 0; i < nama.length; i++) hash = nama.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

const avatarClasses = computed(() => avatarColor(auth.user?.nama_lengkap ?? '?'))

async function changePassword() {
  success.value = ''
  error.value = ''

  if (passwordErrors.value.length > 0) {
    error.value = passwordErrors.value[0]
    return
  }
  if (form.new_password !== form.confirm_password) {
    error.value = 'Konfirmasi password tidak cocok'
    return
  }
  if (!form.current_password) {
    error.value = 'Password saat ini wajib diisi'
    return
  }

  submitting.value = true
  try {
    const data = await authService.changePassword(form.current_password, form.new_password)
    // Backend returns fresh tokens after password change — persist them
    if (data?.access_token) {
      auth.token = data.access_token
      localStorage.setItem('access_token', data.access_token)
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token)
      }
    }
    success.value = 'Password berhasil diubah'
    form.current_password = ''
    form.new_password = ''
    form.confirm_password = ''
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal mengubah password'
  } finally {
    submitting.value = false
  }
}

function logout() {
  auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Pengaturan</h1>
      <p class="text-sm text-gray-500">Kelola akun dan keamanan</p>
    </div>

    <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Informasi Akun</h2>
      <div class="flex items-center gap-4">
        <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold transition shadow-xs ring-4 ring-slate-100" :class="avatarClasses">
          {{ auth.user?.nama_lengkap?.charAt(0).toUpperCase() ?? '?' }}
        </div>
        <div class="min-w-0">
          <p class="truncate text-lg font-semibold text-gray-900">{{ auth.user?.nama_lengkap }}</p>
          <p class="truncate text-sm text-gray-500">{{ auth.user?.email }}</p>
          <span
            :class="[
              'mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
              auth.isAdmin ? 'bg-purple-100 text-purple-800'
                : auth.isKyai ? 'bg-amber-100 text-amber-800'
                : auth.isKepalaAsrama ? 'bg-indigo-100 text-indigo-800'
                : 'bg-emerald-100 text-emerald-800'
            ]"
          >
            {{ auth.isAdmin ? 'Administrator' : auth.isKyai ? 'Kyai' : auth.isKepalaAsrama ? 'Kepala Asrama' : 'Ustadz' }}
          </span>
        </div>
      </div>
    </div>

    <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Ubah Password</h2>

      <div v-if="success" class="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
        {{ success }}
      </div>
      <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {{ error }}
      </div>

      <form class="space-y-4" @submit.prevent="changePassword">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Password Saat Ini</label>
          <input
            v-model="form.current_password"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Password Baru</label>
          <input
            v-model="form.new_password"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <!-- Strength bar -->
          <div v-if="form.new_password" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div class="h-full rounded-full transition-all duration-300" :class="strengthColor" :style="{ width: (strengthScore / 5 * 100) + '%' }"></div>
              </div>
              <span class="text-xs font-semibold whitespace-nowrap" :class="strengthTextClass">
                {{ strengthLabel }}
              </span>
            </div>
            <ul class="flex flex-wrap gap-x-4 gap-y-0.5">
              <li v-for="rule in passwordRules" :key="rule.label" class="flex items-center gap-1 text-xs" :class="rule.test(form.new_password) ? 'text-emerald-600' : 'text-slate-400'">
                <svg v-if="rule.test(form.new_password)" class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <svg v-else class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9" />
                </svg>
                {{ rule.label }}
              </li>
            </ul>
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Konfirmasi Password Baru</label>
          <input
            v-model="form.confirm_password"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p v-if="form.new_password !== form.confirm_password && form.confirm_password.length > 0" class="mt-1 text-xs text-red-600">Password tidak cocok</p>
        </div>
        <button
          type="submit"
          :disabled="submitting"
          class="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {{ submitting ? 'Menyimpan...' : 'Ubah Password' }}
        </button>
      </form>
    </div>

    <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 class="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500">Sesi</h2>
      <p class="mb-4 text-sm text-gray-500">Keluar dari akun Anda</p>
      <button
        type="button"
        @click="logout"
        class="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Keluar
      </button>
    </div>
  </div>
</template>

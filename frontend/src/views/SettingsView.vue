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

const passwordMismatch = computed(
  () => form.new_password !== form.confirm_password && form.confirm_password.length > 0
)
const tooShort = computed(() => form.new_password.length > 0 && form.new_password.length < 6)

async function changePassword() {
  success.value = ''
  error.value = ''

  if (tooShort.value) {
    error.value = 'Password baru minimal 6 karakter'
    return
  }
  if (passwordMismatch.value) {
    error.value = 'Konfirmasi password tidak cocok'
    return
  }
  if (!form.current_password) {
    error.value = 'Password saat ini wajib diisi'
    return
  }

  submitting.value = true
  try {
    await authService.changePassword(form.current_password, form.new_password)
    success.value = 'Password berhasil diubah'
    form.current_password = ''
    form.new_password = ''
    form.confirm_password = ''
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal mengubah password'
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
        <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
          {{ auth.user?.nama_lengkap?.charAt(0).toUpperCase() ?? '?' }}
        </div>
        <div class="min-w-0">
          <p class="truncate text-lg font-semibold text-gray-900">{{ auth.user?.nama_lengkap }}</p>
          <p class="truncate text-sm text-gray-500">{{ auth.user?.email }}</p>
          <span
            :class="[
              'mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
              auth.user?.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
            ]"
          >
            {{ auth.user?.role === 'admin' ? 'Administrator' : 'Ustadz' }}
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
          <p v-if="tooShort" class="mt-1 text-xs text-red-600">Minimal 6 karakter</p>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Konfirmasi Password Baru</label>
          <input
            v-model="form.confirm_password"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p v-if="passwordMismatch" class="mt-1 text-xs text-red-600">Password tidak cocok</p>
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

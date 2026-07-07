<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth'

interface ApiErrorResponse {
  message?: string
  code?: string
}

interface FormErrors {
  email?: string
  password?: string
}

const router = useRouter()
const auth = useAuthStore()

const form = reactive({
  email: '',
  password: ''
})

const errors = reactive<FormErrors>({})
const submitError = ref('')
const showPassword = ref(false)

const inputClass =
  'w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500/30'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(): boolean {
  errors.email = undefined
  errors.password = undefined
  let valid = true

  if (!form.email.trim()) {
    errors.email = 'Email harus diisi'
    valid = false
  } else if (!EMAIL_RE.test(form.email.trim())) {
    errors.email = 'Format email tidak valid'
    valid = false
  }

  if (!form.password) {
    errors.password = 'Password harus diisi'
    valid = false
  }

  return valid
}

function getErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<ApiErrorResponse>
  return axiosErr.response?.data?.message || fallback
}

async function handleSubmit(): Promise<void> {
  submitError.value = ''
  if (!validate()) return

  try {
    await auth.login(form.email.trim(), form.password)
    await router.push({ name: 'dashboard' })
  } catch (err) {
    submitError.value = getErrorMessage(err, 'Gagal masuk. Silakan coba lagi.')
  }
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-4 py-10">
    <!-- Decorative background -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl"></div>
      <div class="absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-emerald-300/20 blur-3xl"></div>
    </div>

    <div class="relative w-full max-w-md">
      <!-- Brand -->
      <div class="mb-6 text-center">
        <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 shadow-lg ring-1 ring-white/25 backdrop-blur">
          <svg class="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2.25l8.25 4.125v6.375c0 4.5-3.375 7.875-8.25 9.375C7.125 20.625 3.75 17.25 3.75 12.75V6.375L12 2.25z" />
            <path d="M9 11.25l2.25 2.25L15 9.75" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-white">SantriVora</h1>
        <p class="mt-1 text-sm text-emerald-100/80">Sistem Manajemen Disiplin Santri</p>
      </div>

      <!-- Card -->
      <div class="rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5 sm:p-8">
        <h2 class="text-lg font-semibold text-slate-900">Masuk ke akun Anda</h2>
        <p class="mt-1 text-sm text-slate-500">Selamat datang kembali, silakan masuk untuk melanjutkan.</p>

        <!-- Server error -->
        <div
          v-if="submitError"
          class="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
          role="alert"
        >
          <svg class="mt-0.5 h-5 w-5 shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21.75 12a9.75 9.75 0 11-19.5 0 9.75 9.75 0 0119.5 0z" />
          </svg>
          <span>{{ submitError }}</span>
        </div>

        <form class="mt-5 space-y-4" novalidate @submit.prevent="handleSubmit">
          <!-- Email -->
          <div>
            <label for="email" class="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input
              id="email"
              v-model="form.email"
              type="email"
              autocomplete="email"
              placeholder="nama@contoh.com"
              :class="[inputClass, errors.email ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300 focus:border-emerald-500']"
            />
            <p v-if="errors.email" class="mt-1.5 text-xs text-red-600">{{ errors.email }}</p>
          </div>

          <!-- Password -->
          <div>
            <label for="password" class="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <div class="relative">
              <input
                id="password"
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="••••••••"
                :class="[inputClass, 'pr-11', errors.password ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300 focus:border-emerald-500']"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-400 transition hover:text-slate-600"
                :aria-label="showPassword ? 'Sembunyikan password' : 'Tampilkan password'"
                @click="showPassword = !showPassword"
              >
                <svg v-if="showPassword" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
                </svg>
                <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
            <p v-if="errors.password" class="mt-1.5 text-xs text-red-600">{{ errors.password }}</p>
          </div>

          <!-- Submit -->
          <button
            type="submit"
            :disabled="auth.loading"
            class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg v-if="auth.loading" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ auth.loading ? 'Memproses...' : 'Masuk' }}
          </button>
        </form>

        <!-- Register link -->
        <p class="mt-6 text-center text-sm text-slate-600">
          Belum punya akun?
          <RouterLink :to="{ name: 'register' }" class="font-semibold text-emerald-600 transition hover:text-emerald-700 hover:underline">
            Daftar di sini
          </RouterLink>
        </p>
      </div>

      <p class="mt-6 text-center text-xs text-emerald-100/70">© {{ new Date().getFullYear() }} SantriVora</p>
    </div>
  </div>
</template>

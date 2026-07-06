<script setup lang="ts">
import { reactive, ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import type { AxiosError } from 'axios'
import { authService } from '@/services'

interface ApiErrorResponse {
  message?: string
  code?: string
}

interface FormErrors {
  nama_lengkap?: string
  email?: string
  password?: string
  confirm_password?: string
}

interface PasswordRule {
  key: string
  label: string
  test: (pw: string) => boolean
}

const router = useRouter()

const form = reactive({
  nama_lengkap: '',
  email: '',
  password: '',
  confirm_password: ''
})

const errors = reactive<FormErrors>({})
const submitError = ref('')
const successMessage = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const submitted = ref(false)

let redirectTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (redirectTimer !== null) clearTimeout(redirectTimer)
})

const inputClass =
  'w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500/30'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const passwordRules: readonly PasswordRule[] = [
  { key: 'min', label: 'Minimal 8 karakter', test: (pw) => pw.length >= 8 },
  { key: 'max', label: 'Maksimal 128 karakter', test: (pw) => pw.length <= 128 },
  { key: 'upper', label: 'Huruf kapital (A-Z)', test: (pw) => /[A-Z]/.test(pw) },
  { key: 'lower', label: 'Huruf kecil (a-z)', test: (pw) => /[a-z]/.test(pw) },
  { key: 'digit', label: 'Angka (0-9)', test: (pw) => /\d/.test(pw) },
  { key: 'special', label: 'Karakter spesial', test: (pw) => /[^A-Za-z0-9]/.test(pw) }
]

function checkRule(rule: PasswordRule): boolean {
  return rule.test(form.password)
}

function getStrengthPercent(): number {
  const passed = passwordRules.filter((r) => r.test(form.password)).length
  return Math.round((passed / passwordRules.length) * 100)
}

const strengthColor = computed(() => {
  const pct = getStrengthPercent()
  if (pct <= 33) return 'bg-red-500'
  if (pct <= 66) return 'bg-amber-500'
  return 'bg-emerald-500'
})

function validate(): boolean {
  errors.nama_lengkap = undefined
  errors.email = undefined
  errors.password = undefined
  errors.confirm_password = undefined
  let valid = true

  const name = form.nama_lengkap.trim()
  if (!name) {
    errors.nama_lengkap = 'Nama lengkap harus diisi'
    valid = false
  } else if (name.length < 2) {
    errors.nama_lengkap = 'Nama lengkap minimal 2 karakter'
    valid = false
  } else if (name.length > 100) {
    errors.nama_lengkap = 'Nama lengkap maksimal 100 karakter'
    valid = false
  }

  const email = form.email.trim()
  if (!email) {
    errors.email = 'Email harus diisi'
    valid = false
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Format email tidak valid'
    valid = false
  } else if (email.length > 255) {
    errors.email = 'Email maksimal 255 karakter'
    valid = false
  }

  if (!form.password) {
    errors.password = 'Password harus diisi'
    valid = false
  } else {
    const failed = passwordRules.filter((r) => !r.test(form.password)).map((r) => r.label)
    if (failed.length > 0) {
      errors.password = 'Password belum memenuhi syarat berikut: ' + failed.join(', ')
      valid = false
    }
  }

  if (!form.confirm_password) {
    errors.confirm_password = 'Konfirmasi password harus diisi'
    valid = false
  } else if (form.password && form.confirm_password !== form.password) {
    errors.confirm_password = 'Konfirmasi password tidak cocok'
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
  if (submitted.value) return
  if (!validate()) return

  submitted.value = true

  try {
    await authService.register(form.email.trim(), form.password, form.nama_lengkap.trim())
    successMessage.value = 'Akun berhasil dibuat. Menunggu persetujuan admin.'
    redirectTimer = setTimeout(() => {
      router.push({ name: 'login' })
    }, 3000)
  } catch (err) {
    submitted.value = false
    submitError.value = getErrorMessage(err, 'Gagal mendaftar. Silakan coba lagi.')
  }
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-4 py-10">
    <!-- Decorative background -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl"></div>
      <div class="absolute -bottom-32 -left-16 h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl"></div>
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
        <h2 class="text-lg font-semibold text-slate-900">Buat akun baru</h2>
        <p class="mt-1 text-sm text-slate-500">Daftar untuk mulai menggunakan SantriVora.</p>

        <!-- Success -->
        <div
          v-if="successMessage"
          class="mt-5 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700"
          role="alert"
        >
          <svg class="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p>{{ successMessage }}</p>
            <p class="mt-1 text-emerald-600/70">Mengarahkan ke halaman masuk dalam 3 detik...</p>
          </div>
        </div>

        <!-- Server error -->
        <div
          v-else-if="submitError"
          class="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
          role="alert"
        >
          <svg class="mt-0.5 h-5 w-5 shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21.75 12a9.75 9.75 0 11-19.5 0 9.75 9.75 0 0119.5 0z" />
          </svg>
          <span>{{ submitError }}</span>
        </div>

        <form v-if="!successMessage" class="mt-5 space-y-4" novalidate @submit.prevent="handleSubmit">
          <!-- Nama Lengkap -->
          <div>
            <label for="nama_lengkap" class="mb-1.5 block text-sm font-medium text-slate-700">Nama Lengkap</label>
            <input
              id="nama_lengkap"
              v-model="form.nama_lengkap"
              type="text"
              autocomplete="name"
              placeholder="Nama lengkap Anda"
              :class="[inputClass, errors.nama_lengkap ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300 focus:border-emerald-500']"
            />
            <p v-if="errors.nama_lengkap" class="mt-1.5 text-xs text-red-600">{{ errors.nama_lengkap }}</p>
          </div>

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
                autocomplete="new-password"
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

            <!-- Strength meter -->
            <div v-if="form.password.length > 0" class="mt-2.5">
              <div class="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :style="{ width: getStrengthPercent() + '%' }"
                  :class="strengthColor"
                ></div>
              </div>
              <ul class="flex flex-wrap gap-x-4 gap-y-1">
                <li
                  v-for="rule in passwordRules"
                  :key="rule.key"
                  class="flex items-center gap-1 text-xs"
                  :class="checkRule(rule) ? 'text-emerald-600' : 'text-slate-400'"
                >
                  <span v-if="checkRule(rule)" class="text-emerald-500">✓</span>
                  <span v-else class="text-slate-300">•</span>
                  {{ rule.label }}
                </li>
              </ul>
            </div>
            <p v-if="errors.password" class="mt-1.5 text-xs text-red-600">{{ errors.password }}</p>
          </div>

          <!-- Confirm Password -->
          <div>
            <label for="confirm_password" class="mb-1.5 block text-sm font-medium text-slate-700">Konfirmasi Password</label>
            <div class="relative">
              <input
                id="confirm_password"
                v-model="form.confirm_password"
                :type="showConfirmPassword ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="••••••••"
                :class="[inputClass, 'pr-11', errors.confirm_password ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300 focus:border-emerald-500']"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-400 transition hover:text-slate-600"
                :aria-label="showConfirmPassword ? 'Sembunyikan konfirmasi' : 'Tampilkan konfirmasi'"
                @click="showConfirmPassword = !showConfirmPassword"
              >
                <svg v-if="showConfirmPassword" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
                </svg>
                <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
            <p v-if="errors.confirm_password" class="mt-1.5 text-xs text-red-600">{{ errors.confirm_password }}</p>
          </div>

          <!-- Submit -->
          <button
            type="submit"
            :disabled="submitted"
            class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg v-if="submitted" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ submitted ? 'Memproses...' : 'Daftar' }}
          </button>
        </form>

        <!-- Login link -->
        <p class="mt-6 text-center text-sm text-slate-600">
          Sudah punya akun?
          <RouterLink :to="{ name: 'login' }" class="font-semibold text-emerald-600 transition hover:text-emerald-700 hover:underline">
            Masuk di sini
          </RouterLink>
        </p>
      </div>

      <p class="mt-6 text-center text-xs text-emerald-100/70">© {{ new Date().getFullYear() }} SantriVora</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { adminService, kelasService } from '@/services'

interface Kelas {
  id: string
  nama: string
  tingkatan?: string
}

interface User {
  id: string
  nama_lengkap: string
  email: string
  role: 'admin' | 'ustadz'
  status: 'pending' | 'approved' | 'suspended'
  assigned_kelas?: Kelas[]
}

type TabStatus = 'pending' | 'approved' | 'suspended'

const activeTab = ref<TabStatus>('pending')
const users = ref<User[]>([])
const kelasList = ref<Kelas[]>([])
const loading = ref(false)
const error = ref('')

const approveTarget = ref<User | null>(null)
const approveForm = reactive<{ kelas_ids: string[] }>({ kelas_ids: [] })
const approveSubmitting = ref(false)

const resetTarget = ref<User | null>(null)
const resetForm = reactive({ new_password: '' })
const resetSubmitting = ref(false)

const tabs: { key: TabStatus; label: string }[] = [
  { key: 'pending', label: 'Menunggu' },
  { key: 'approved', label: 'Disetujui' },
  { key: 'suspended', label: 'Ditangguhkan' }
]

async function fetchKelas() {
  try {
    kelasList.value = (await kelasService.list()) as Kelas[]
  } catch {
    kelasList.value = []
  }
}

async function fetchUsers() {
  loading.value = true
  error.value = ''
  try {
    const res = await adminService.getUsers(activeTab.value, 1, 100)
    users.value = res.data ?? []
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal memuat pengguna'
  } finally {
    loading.value = false
  }
}

function switchTab(tab: TabStatus) {
  activeTab.value = tab
  fetchUsers()
}

function openApprove(u: User) {
  approveTarget.value = u
  approveForm.kelas_ids = u.assigned_kelas?.map((k) => k.id) ?? []
}

async function submitApprove() {
  if (!approveTarget.value) return
  approveSubmitting.value = true
  try {
    await adminService.approveUser(approveTarget.value.id, approveForm.kelas_ids)
    approveTarget.value = null
    await fetchUsers()
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal menyetujui pengguna'
  } finally {
    approveSubmitting.value = false
  }
}

async function suspendUser(id: string) {
  if (!confirm('Tangguhkan pengguna ini?')) return
  try {
    await adminService.suspendUser(id)
    await fetchUsers()
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal menangguhkan pengguna'
  }
}

async function activateUser(id: string) {
  try {
    await adminService.activateUser(id)
    await fetchUsers()
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal mengaktifkan pengguna'
  }
}

function openReset(u: User) {
  resetTarget.value = u
  resetForm.new_password = ''
}

async function submitReset() {
  if (!resetTarget.value) return
  if (resetForm.new_password.length < 6) {
    error.value = 'Password minimal 6 karakter'
    return
  }
  resetSubmitting.value = true
  try {
    await adminService.resetPassword(resetTarget.value.id, resetForm.new_password)
    resetTarget.value = null
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal reset password'
  } finally {
    resetSubmitting.value = false
  }
}

function roleBadge(role: string) {
  return role === 'admin'
    ? 'bg-purple-100 text-purple-800'
    : 'bg-blue-100 text-blue-800'
}

onMounted(() => {
  fetchKelas()
  fetchUsers()
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Manajemen Pengguna</h1>
      <p class="text-sm text-gray-500">Setujui, tangguhkan, dan kelola akun pengguna</p>
    </div>

    <div class="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="[
          'flex-1 rounded-md px-4 py-2 text-sm font-medium transition',
          activeTab === tab.key
            ? 'bg-white text-emerald-700 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        ]"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="h-24 animate-pulse rounded-xl bg-gray-100"></div>
    </div>

    <div
      v-else-if="users.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"
    >
      <svg class="mb-3 h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
      <p class="text-sm font-medium text-gray-600">Tidak ada pengguna</p>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="u in users"
        :key="u.id"
        class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                {{ u.nama_lengkap.charAt(0).toUpperCase() }}
              </div>
              <div class="min-w-0">
                <p class="truncate font-semibold text-gray-900">{{ u.nama_lengkap }}</p>
                <p class="truncate text-sm text-gray-500">{{ u.email }}</p>
              </div>
              <span :class="['ml-1 inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', roleBadge(u.role)]">
                {{ u.role }}
              </span>
            </div>

            <div v-if="u.assigned_kelas && u.assigned_kelas.length > 0" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="k in u.assigned_kelas"
                :key="k.id"
                class="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
              >
                {{ k.nama }}
              </span>
            </div>
          </div>

          <div class="flex shrink-0 flex-wrap gap-2">
            <template v-if="activeTab === 'pending'">
              <button
                type="button"
                @click="openApprove(u)"
                class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
              >
                Setujui
              </button>
            </template>
            <template v-else-if="activeTab === 'approved'">
              <button
                type="button"
                @click="openApprove(u)"
                class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Edit Kelas
              </button>
              <button
                type="button"
                @click="suspendUser(u.id)"
                class="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-700 transition hover:bg-yellow-100"
              >
                Tangguhkan
              </button>
              <button
                type="button"
                @click="openReset(u)"
                class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Reset Password
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                @click="activateUser(u.id)"
                class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
              >
                Aktifkan
              </button>
              <button
                type="button"
                @click="openReset(u)"
                class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Reset Password
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="approveTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="approveTarget = null"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-1 text-lg font-semibold text-gray-900">Setujui Pengguna</h2>
        <p class="mb-4 text-sm text-gray-500">
          Pilih kelas untuk <strong>{{ approveTarget.nama_lengkap }}</strong>
        </p>
        <div class="mb-4 max-h-60 space-y-2 overflow-y-auto">
          <label
            v-for="k in kelasList"
            :key="k.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition hover:bg-gray-50"
          >
            <input
              v-model="approveForm.kelas_ids"
              type="checkbox"
              :value="k.id"
              class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span class="text-sm text-gray-700">
              {{ k.nama }}
              <span v-if="k.tingkatan" class="text-gray-400">· {{ k.tingkatan }}</span>
            </span>
          </label>
          <p v-if="kelasList.length === 0" class="py-4 text-center text-sm text-gray-400">
            Belum ada kelas tersedia
          </p>
        </div>
        <div class="flex gap-3">
          <button
            type="button"
            :disabled="approveSubmitting"
            @click="submitApprove"
            class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {{ approveSubmitting ? 'Memproses...' : 'Setujui' }}
          </button>
          <button
            type="button"
            @click="approveTarget = null"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Batal
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="resetTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="resetTarget = null"
    >
      <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-1 text-lg font-semibold text-gray-900">Reset Password</h2>
        <p class="mb-4 text-sm text-gray-500">
          Atur password baru untuk <strong>{{ resetTarget.nama_lengkap }}</strong>
        </p>
        <div class="mb-4">
          <label class="mb-1 block text-sm font-medium text-gray-700">Password Baru</label>
          <input
            v-model="resetForm.new_password"
            type="password"
            placeholder="Minimal 6 karakter"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div class="flex gap-3">
          <button
            type="button"
            :disabled="resetSubmitting"
            @click="submitReset"
            class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {{ resetSubmitting ? 'Memproses...' : 'Reset Password' }}
          </button>
          <button
            type="button"
            @click="resetTarget = null"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { santriService, kelasService } from '@/services'

interface Santri {
  id: string
  nama_lengkap: string
  jenis_kelamin: 'L' | 'P'
  kelas?: { id: string; nama: string }
  kelas_nama?: string
  angkatan?: string | number
  status: string
}

interface Kelas {
  id: string
  nama: string
}

const router = useRouter()

const items = ref<Santri[]>([])
const kelasOptions = ref<Kelas[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')

const search = ref('')
const filterKelas = ref('')
const filterKelamin = ref('')
const filterStatus = ref('')

const cursor = ref<string | undefined>(undefined)
const hasMore = ref(false)

const deleteTarget = ref<Santri | null>(null)
const deleting = ref(false)

const statusLabels: Record<string, string> = {
  aktif: 'Aktif',
  lulus: 'Lulus',
  nonaktif: 'Nonaktif',
}

const statusBadge: Record<string, string> = {
  aktif: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  lulus: 'bg-sky-50 text-sky-700 ring-sky-200',
  nonaktif: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((s) => s.nama_lengkap.toLowerCase().includes(q))
})

function kelaminLabel(k: string) {
  return k === 'L' ? 'Laki-laki' : k === 'P' ? 'Perempuan' : k
}

async function loadKelas() {
  try {
    kelasOptions.value = await kelasService.list()
  } catch {
    kelasOptions.value = []
  }
}

async function fetchList(append = false) {
  if (!append) loading.value = true
  else loadingMore.value = true
  if (!append) error.value = ''
  try {
    const params: Record<string, string | number | undefined> = { limit: 20 }
    if (filterKelas.value) params.kelas_id = filterKelas.value
    if (filterKelamin.value) params.jenis_kelamin = filterKelamin.value
    if (filterStatus.value) params.status = filterStatus.value
    if (append && cursor.value) params.cursor = cursor.value

    const res = await santriService.list(params)
    const data = res.data as Santri[]
    const pagination = res.pagination as { cursor?: string; hasMore?: boolean }
    items.value = append ? [...items.value, ...data] : data
    cursor.value = pagination?.cursor
    hasMore.value = !!pagination?.hasMore
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat data santri.'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  if (hasMore.value && !loadingMore.value) fetchList(true)
}

function resetFilters() {
  search.value = ''
  filterKelas.value = ''
  filterKelamin.value = ''
  filterStatus.value = ''
}

watch([filterKelas, filterKelamin, filterStatus], () => {
  cursor.value = undefined
  fetchList(false)
})

function confirmDelete(s: Santri) {
  deleteTarget.value = s
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await santriService.remove(deleteTarget.value.id)
    items.value = items.value.filter((s) => s.id !== deleteTarget.value!.id)
    deleteTarget.value = null
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menghapus santri.'
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  loadKelas()
  fetchList(false)
})
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Data Santri</h1>
        <p class="text-sm text-slate-500 mt-1">Kelola seluruh data santri pesantren.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          @click="router.push({ name: 'santri-import' })"
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Impor CSV
        </button>
        <button
          @click="router.push({ name: 'santri-new' })"
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Tambah Santri
        </button>
      </div>
    </div>

    <!-- Filter bar -->
    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="sm:col-span-2 lg:col-span-1">
          <label class="mb-1 block text-xs font-medium text-slate-600">Cari nama</label>
          <div class="relative">
            <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              v-model="search"
              type="text"
              placeholder="Cari santri..."
              class="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-600">Kelas</label>
          <select
            v-model="filterKelas"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
          >
            <option value="">Semua kelas</option>
            <option v-for="k in kelasOptions" :key="k.id" :value="k.id">{{ k.nama }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-600">Jenis Kelamin</label>
          <select
            v-model="filterKelamin"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
          >
            <option value="">Semua</option>
            <option value="L">Laki-laki</option>
            <option value="P">Perempuan</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-600">Status</label>
          <select
            v-model="filterStatus"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
          >
            <option value="">Semua</option>
            <option value="aktif">Aktif</option>
            <option value="lulus">Lulus</option>
            <option value="nonaktif">Nonaktif</option>
          </select>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <button
          @click="resetFilters"
          class="text-xs font-medium text-slate-500 hover:text-emerald-700"
        >Reset filter</button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ error }}</div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div class="space-y-0 divide-y divide-slate-50">
        <div v-for="i in 6" :key="i" class="flex items-center gap-4 p-4">
          <div class="h-9 w-9 rounded-full bg-slate-200"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 w-40 rounded bg-slate-200"></div>
            <div class="h-3 w-24 rounded bg-slate-100"></div>
          </div>
          <div class="h-6 w-16 rounded-full bg-slate-100"></div>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div v-else-if="filtered.length || search" class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-100 text-sm">
          <thead class="bg-slate-50">
            <tr>
              <th class="px-5 py-3 text-left font-semibold text-slate-600">Nama</th>
              <th class="px-5 py-3 text-left font-semibold text-slate-600">L/P</th>
              <th class="px-5 py-3 text-left font-semibold text-slate-600">Kelas</th>
              <th class="px-5 py-3 text-left font-semibold text-slate-600">Angkatan</th>
              <th class="px-5 py-3 text-left font-semibold text-slate-600">Status</th>
              <th class="px-5 py-3 text-right font-semibold text-slate-600">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-50">
            <tr v-for="s in filtered" :key="s.id" class="hover:bg-slate-50/60">
              <td class="px-5 py-3">
                <div class="flex items-center gap-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                    {{ s.nama_lengkap.charAt(0).toUpperCase() }}
                  </div>
                  <span class="font-medium text-slate-800">{{ s.nama_lengkap }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-slate-600">{{ kelaminLabel(s.jenis_kelamin) }}</td>
              <td class="px-5 py-3 text-slate-600">{{ s.kelas?.nama ?? s.kelas_nama ?? '-' }}</td>
              <td class="px-5 py-3 text-slate-600">{{ s.angkatan ?? '-' }}</td>
              <td class="px-5 py-3">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset"
                  :class="statusBadge[s.status] || statusBadge.nonaktif"
                >{{ statusLabels[s.status] || s.status }}</span>
              </td>
              <td class="px-5 py-3">
                <div class="flex items-center justify-end gap-1">
                  <button
                    @click="router.push({ name: 'santri-detail', params: { id: s.id } })"
                    title="Lihat detail"
                    class="rounded-md p-1.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" d="M2.46 12C3.73 7.94 7.52 5 12 5s8.27 2.94 9.54 7c-1.27 4.06-5.06 7-9.54 7s-8.27-2.94-9.54-7z" />
                    </svg>
                  </button>
                  <button
                    @click="router.push({ name: 'santri-edit', params: { id: s.id } })"
                    title="Edit"
                    class="rounded-md p-1.5 text-slate-500 hover:bg-sky-50 hover:text-sky-700"
                  >
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    @click="confirmDelete(s)"
                    title="Hapus"
                    class="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="6" class="px-5 py-10 text-center text-slate-400">
                Tidak ada santri yang cocok dengan pencarian "{{ search }}".
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Empty state (no items at all) -->
    <div v-else class="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
        <svg class="h-7 w-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      </div>
      <h3 class="mt-4 text-sm font-semibold text-slate-800">Belum ada santri</h3>
      <p class="mt-1 text-sm text-slate-500">Mulai dengan menambahkan data santri pertama Anda.</p>
      <button
        @click="router.push({ name: 'santri-new' })"
        class="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Tambah Santri
      </button>
    </div>

    <!-- Load more -->
    <div v-if="hasMore && !loading" class="flex justify-center">
      <button
        @click="loadMore"
        :disabled="loadingMore"
        class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <svg v-if="loadingMore" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        {{ loadingMore ? 'Memuat...' : 'Muat lebih banyak' }}
      </button>
    </div>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/50" @click="!deleting && (deleteTarget = null)"></div>
        <div class="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <div class="flex items-start gap-4">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100">
              <svg class="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
            </div>
            <div class="min-w-0">
              <h3 class="text-base font-semibold text-slate-900">Hapus santri?</h3>
              <p class="mt-1 text-sm text-slate-500">
                Anda akan menghapus <span class="font-medium text-slate-700">{{ deleteTarget.nama_lengkap }}</span>.
                Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button
              @click="deleteTarget = null"
              :disabled="deleting"
              class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >Batal</button>
            <button
              @click="doDelete"
              :disabled="deleting"
              class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <span v-if="deleting">Menghapus...</span>
              <span v-else>Hapus</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

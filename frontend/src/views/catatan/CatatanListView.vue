<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { catatanService, kelasService } from '@/services'
import { useAuthStore } from '@/stores/auth'

interface Catatan {
  id: string
  tanggal_kejadian: string
  santri_nama: string
  tipe: 'pelanggaran' | 'prestasi'
  judul: string
  kategori_nama?: string
  dicatat_oleh_nama: string
}

interface Kelas {
  id: string
  nama: string
  tingkatan?: string
}

const catatanList = ref<Catatan[]>([])
const auth = useAuthStore()
const kelasList = ref<Kelas[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const hasMore = ref(false)
const cursor = ref<string | undefined>(undefined)

const filters = reactive({
  tipe: '',
  kelas_id: '',
  tanggal_dari: '',
  tanggal_sampai: ''
})

async function fetchKelas() {
  try {
    kelasList.value = (await kelasService.list()) as Kelas[]
  } catch {
    kelasList.value = []
  }
}

async function fetchCatatan(reset = false) {
  if (reset) {
    cursor.value = undefined
    catatanList.value = []
  }
  loading.value = reset
  loadingMore.value = !reset
  error.value = ''
  try {
    const params: Record<string, unknown> = { limit: 20 }
    if (filters.tipe) params.tipe = filters.tipe
    if (filters.kelas_id) params.kelas_id = filters.kelas_id
    if (cursor.value) params.cursor = cursor.value
    if (filters.tanggal_dari) params.tanggal_dari = filters.tanggal_dari
    if (filters.tanggal_sampai) params.tanggal_sampai = filters.tanggal_sampai

    const res = await catatanService.list(params)
    catatanList.value = reset ? res.data : [...catatanList.value, ...res.data]
    cursor.value = res.pagination?.cursor
    hasMore.value = !!res.pagination?.hasMore
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal memuat catatan'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function removeCatatan(id: string) {
  if (!confirm('Hapus catatan ini?')) return
  try {
    await catatanService.remove(id)
    catatanList.value = catatanList.value.filter((c) => c.id !== id)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal menghapus catatan'
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

function applyFilters() {
  fetchCatatan(true)
}

function resetFilters() {
  filters.tipe = ''
  filters.kelas_id = ''
  filters.tanggal_dari = ''
  filters.tanggal_sampai = ''
  fetchCatatan(true)
}

onMounted(() => {
  fetchKelas()
  fetchCatatan(true)
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Catatan Santri</h1>
        <p class="text-sm text-gray-500">Daftar pelanggaran dan prestasi santri</p>
      </div>
      <RouterLink
        v-if="!auth.isReadOnly"
        :to="{ name: 'catatan-new' }"
        class="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        + Tambah Catatan
      </RouterLink>
    </div>

    <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600">Tipe</label>
          <select
            v-model="filters.tipe"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Semua</option>
            <option value="pelanggaran">Pelanggaran</option>
            <option value="prestasi">Prestasi</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600">Kelas</label>
          <select
            v-model="filters.kelas_id"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Semua Kelas</option>
            <option v-for="k in kelasList" :key="k.id" :value="k.id">{{ k.nama }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600">Dari Tanggal</label>
          <input
            v-model="filters.tanggal_dari"
            type="date"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600">Sampai Tanggal</label>
          <input
            v-model="filters.tanggal_sampai"
            type="date"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <button
          type="button"
          @click="applyFilters"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
        >
          Terapkan
        </button>
        <button
          type="button"
          @click="resetFilters"
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Reset
        </button>
      </div>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 5" :key="i" class="h-14 animate-pulse rounded-lg bg-gray-100"></div>
    </div>

    <div
      v-else-if="catatanList.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"
    >
      <svg class="mb-3 h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p class="text-sm font-medium text-gray-600">Belum ada catatan</p>
      <p class="text-xs text-gray-400">Catatan pelanggaran/prestasi akan muncul di sini</p>
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tanggal</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Santri</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tipe</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Judul</th>
              <th class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 md:table-cell">Kategori</th>
              <th class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 lg:table-cell">Dicatat Oleh</th>
              <th v-if="!auth.isReadOnly" class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="c in catatanList" :key="c.id" class="transition hover:bg-gray-50">
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{{ formatDate(c.tanggal_kejadian) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ c.santri_nama }}</td>
              <td class="px-4 py-3">
                <span
                  :class="[
                    'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                    c.tipe === 'pelanggaran'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-green-100 text-green-800'
                  ]"
                >
                  {{ c.tipe === 'pelanggaran' ? 'Pelanggaran' : 'Prestasi' }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-700">{{ c.judul }}</td>
              <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600 md:table-cell">{{ c.kategori_nama || '-' }}</td>
              <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600 lg:table-cell">{{ c.dicatat_oleh_nama }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <button
                  v-if="!auth.isReadOnly"
                  type="button"
                  @click="removeCatatan(c.id)"
                  class="rounded-md p-1.5 text-red-600 transition hover:bg-red-50"
                  title="Hapus"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="hasMore" class="flex justify-center">
      <button
        type="button"
        :disabled="loadingMore"
        @click="fetchCatatan(false)"
        class="inline-flex items-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
      >
        {{ loadingMore ? 'Memuat...' : 'Muat Lebih Banyak' }}
      </button>
    </div>
  </div>
</template>

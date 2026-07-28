<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useEntityList } from '@/offline/composables/useEntityList'
import { useEntityMutation } from '@/offline/composables/useEntityMutation'

interface Catatan {
  id: string
  santri_id: string
  tanggal_kejadian: string
  tipe: 'pelanggaran' | 'prestasi'
  judul: string
  kategori_id?: string | null
  is_deleted?: number
}

interface Santri {
  id: string
  nama_lengkap: string
  kelas_id: string | null
}

interface Kelas {
  id: string
  nama: string
  tingkatan?: string
}

interface Kategori {
  id: string
  nama: string
}

const auth = useAuthStore()

// santri & kategori_pelanggaran sudah ke-cache — dipakai buat resolve nama
// (dulu JOIN server: santri_nama, kategori_nama). dicatat_oleh_nama SENGAJA
// DIHILANGKAN dari tampilan — itu JOIN ke tabel users, yang gak pernah masuk
// sync cache sama sekali (personel/users dikecualikan permanen demi alasan
// keamanan, lihat plan §A.5), dan endpoint GET /api/personel yang bisa kasih
// nama itu khusus admin/kyai (ustadz bakal 403 kalau dipaksa manggil itu buat
// sekadar label) — gak ada cara resolve ini client-side utk semua role.
const { allItems: allSantri } = useEntityList<Santri>('santri')
const { allItems: kelasList } = useEntityList<Kelas>('kelas')
const { allItems: kategoriList } = useEntityList<Kategori>('kategori_pelanggaran')
const santriNameById = computed(() => new Map(allSantri.value.map((s) => [s.id, s.nama_lengkap])))
const kategoriNameById = computed(() => new Map(kategoriList.value.map((k) => [k.id, k.nama])))
const santriKelasIdById = computed(() => new Map(allSantri.value.map((s) => [s.id, s.kelas_id])))

const filters = reactive({
  tipe: '',
  kelas_id: '',
  tanggal_dari: '',
  tanggal_sampai: ''
})

const {
  items: catatanList,
  loading,
  hasMoreLocal,
  loadMore,
  resetWindow
} = useEntityList<Catatan>('catatan_disiplin', {
  filter: (c) => {
    if (c.is_deleted) return false
    if (filters.tipe && c.tipe !== filters.tipe) return false
    if (filters.kelas_id && santriKelasIdById.value.get(c.santri_id) !== filters.kelas_id) return false
    if (filters.tanggal_dari && c.tanggal_kejadian < filters.tanggal_dari) return false
    if (filters.tanggal_sampai && c.tanggal_kejadian > filters.tanggal_sampai) return false
    return true
  },
  sort: (a, b) => b.tanggal_kejadian.localeCompare(a.tanggal_kejadian),
  pageSize: 20
})

const mutation = useEntityMutation<Catatan>('catatan_disiplin')
const error = ref('')

watch(filters, resetWindow)

async function removeCatatan(id: string) {
  if (!confirm('Hapus catatan ini?')) return
  try {
    await mutation.remove(id)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menghapus catatan'
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

function resetFilters() {
  filters.tipe = ''
  filters.kelas_id = ''
  filters.tanggal_dari = ''
  filters.tanggal_sampai = ''
}
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
          @click="resetFilters"
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Reset filter
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
              <th v-if="!auth.isReadOnly" class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="c in catatanList" :key="c.id" class="transition hover:bg-gray-50">
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{{ formatDate(c.tanggal_kejadian) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ santriNameById.get(c.santri_id) ?? '-' }}</td>
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
              <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600 md:table-cell">{{ c.kategori_id ? (kategoriNameById.get(c.kategori_id) ?? '-') : '-' }}</td>
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

    <div v-if="hasMoreLocal" class="flex justify-center">
      <button
        type="button"
        @click="loadMore"
        class="inline-flex items-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
      >
        Muat Lebih Banyak
      </button>
    </div>
  </div>
</template>

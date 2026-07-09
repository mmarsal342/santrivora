<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { catatanService, santriService, kategoriService } from '@/services'

interface Santri {
  id: string
  nama_lengkap: string
  nis?: string
  kelas_nama?: string
}

interface Kategori {
  id: string
  nama: string
}

const router = useRouter()
const santriList = ref<Santri[]>([])
const kategoriList = ref<Kategori[]>([])
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const santriSearch = ref('')
const santriDropdownOpen = ref(false)

const form = reactive({
  santri_id: '',
  tipe: 'pelanggaran' as 'pelanggaran' | 'prestasi',
  kategori_id: '',
  jenis_prestasi: '',
  judul: '',
  deskripsi: '',
  tanggal_kejadian: new Date().toISOString().slice(0, 10),
  tindak_lanjut: ''
})

const selectedSantri = computed(() =>
  santriList.value.find((s) => s.id === form.santri_id)
)

const filteredSantri = computed(() => {
  if (!santriSearch.value) return santriList.value.slice(0, 50)
  const q = santriSearch.value.toLowerCase()
  return santriList.value
    .filter(
      (s) =>
        s.nama_lengkap.toLowerCase().includes(q) ||
        (s.nis ?? '').toLowerCase().includes(q)
    )
    .slice(0, 50)
})

async function fetchSantri() {
  try {
    const res = await santriService.list({ limit: 500 })
    santriList.value = res.data ?? []
  } catch {
    santriList.value = []
  }
}

async function fetchKategori() {
  try {
    kategoriList.value = (await kategoriService.list()) as Kategori[]
  } catch {
    kategoriList.value = []
  }
}

function selectSantri(s: Santri) {
  form.santri_id = s.id
  santriSearch.value = ''
  santriDropdownOpen.value = false
}

const santriDropdownRef = ref<HTMLElement | null>(null)
function handleOutsideClick(e: MouseEvent) {
  if (santriDropdownOpen.value && santriDropdownRef.value && !santriDropdownRef.value.contains(e.target as Node)) {
    santriDropdownOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', handleOutsideClick))
onUnmounted(() => document.removeEventListener('click', handleOutsideClick))

async function submit() {
  error.value = ''
  if (!form.santri_id) {
    error.value = 'Santri harus dipilih'
    return
  }
  if (!form.judul.trim()) {
    error.value = 'Judul wajib diisi'
    return
  }

  submitting.value = true
  try {
    const payload: Record<string, unknown> = {
      santri_id: form.santri_id,
      tipe: form.tipe,
      judul: form.judul,
      deskripsi: form.deskripsi,
      tanggal_kejadian: form.tanggal_kejadian,
      tindak_lanjut: form.tindak_lanjut
    }
    if (form.tipe === 'pelanggaran' && form.kategori_id) {
      payload.kategori_id = form.kategori_id
    }
    if (form.tipe === 'prestasi' && form.jenis_prestasi.trim()) {
      payload.jenis_prestasi = form.jenis_prestasi.trim()
    }
    await catatanService.create(payload)
    router.push({ name: 'catatan' })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal menyimpan catatan'
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loading.value = true
  Promise.all([fetchSantri(), fetchKategori()]).finally(() => {
    loading.value = false
  })
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Tambah Catatan</h1>
        <p class="text-sm text-gray-500">Catat pelanggaran atau prestasi santri</p>
      </div>
      <button
        type="button"
        @click="router.push({ name: 'catatan' })"
        class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        Kembali
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div v-if="loading" class="space-y-4">
        <div class="h-10 animate-pulse rounded-lg bg-gray-100"></div>
        <div class="h-10 animate-pulse rounded-lg bg-gray-100"></div>
        <div class="h-10 animate-pulse rounded-lg bg-gray-100"></div>
      </div>

      <form v-else class="space-y-5" @submit.prevent="submit">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Santri <span class="text-red-500">*</span></label>
          <div ref="santriDropdownRef" class="relative">
            <button
              type="button"
              @click="santriDropdownOpen = !santriDropdownOpen"
              class="flex w-full items-center justify-between rounded-lg border border-gray-300 px-3 py-2 text-left text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <span v-if="selectedSantri" class="font-medium text-gray-900">
                {{ selectedSantri.nama_lengkap }}
                <span v-if="selectedSantri.kelas_nama" class="text-gray-400">— {{ selectedSantri.kelas_nama }}</span>
              </span>
              <span v-else class="text-gray-400">Pilih santri...</span>
              <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div
              v-if="santriDropdownOpen"
              class="absolute z-10 mt-1 max-h-72 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
            >
              <div class="border-b border-gray-100 p-2">
                <input
                  v-model="santriSearch"
                  type="text"
                  placeholder="Cari nama atau NIS..."
                  class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  @click.stop
                />
              </div>
              <div class="max-h-56 overflow-y-auto">
                <button
                  v-for="s in filteredSantri"
                  :key="s.id"
                  type="button"
                  @click="selectSantri(s)"
                  class="block w-full px-3 py-2 text-left text-sm transition hover:bg-emerald-50"
                >
                  <span class="font-medium text-gray-900">{{ s.nama_lengkap }}</span>
                  <span v-if="s.nis" class="text-gray-400"> · {{ s.nis }}</span>
                  <span v-if="s.kelas_nama" class="block text-xs text-gray-400">{{ s.kelas_nama }}</span>
                </button>
                <p v-if="filteredSantri.length === 0" class="px-3 py-4 text-center text-sm text-gray-400">
                  Santri tidak ditemukan
                </p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Tipe <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-2 gap-3">
            <label
              :class="[
                'flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition',
                form.tipe === 'pelanggaran'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              ]"
            >
              <input v-model="form.tipe" type="radio" value="pelanggaran" class="sr-only" />
              Pelanggaran
            </label>
            <label
              :class="[
                'flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition',
                form.tipe === 'prestasi'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              ]"
            >
              <input v-model="form.tipe" type="radio" value="prestasi" class="sr-only" />
              Prestasi
            </label>
          </div>
        </div>

        <div v-if="form.tipe === 'pelanggaran'">
          <label class="mb-1 block text-sm font-medium text-gray-700">Kategori</label>
          <select
            v-model="form.kategori_id"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">— Pilih kategori —</option>
            <option v-for="k in kategoriList" :key="k.id" :value="k.id">{{ k.nama }}</option>
          </select>
        </div>

        <div v-if="form.tipe === 'prestasi'">
          <label class="mb-1 block text-sm font-medium text-gray-700">Jenis Prestasi</label>
          <input
            v-model="form.jenis_prestasi"
            type="text"
            placeholder="Bebas, misal: Hafalan Juz 30, Juara Lomba Adzan, dll..."
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p class="mt-1 text-xs text-gray-400">Tulis bebas sesuai yang ustadz anggap sebagai prestasi, tidak terikat kategori tetap.</p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Judul <span class="text-red-500">*</span></label>
          <input
            v-model="form.judul"
            type="text"
            placeholder="Ringkasan singkat"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Deskripsi</label>
          <textarea
            v-model="form.deskripsi"
            rows="3"
            placeholder="Detail kejadian..."
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          ></textarea>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Tanggal Kejadian</label>
          <input
            v-model="form.tanggal_kejadian"
            type="date"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Tindak Lanjut</label>
          <textarea
            v-model="form.tindak_lanjut"
            rows="2"
            placeholder="Rencana tindak lanjut (opsional)..."
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          ></textarea>
        </div>

        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            :disabled="submitting"
            class="inline-flex flex-1 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {{ submitting ? 'Menyimpan...' : 'Simpan Catatan' }}
          </button>
          <button
            type="button"
            @click="router.push({ name: 'catatan' })"
            class="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Batal
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

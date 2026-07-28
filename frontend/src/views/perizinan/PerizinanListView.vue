<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { perizinanService, santriService } from '@/services'
import { useAuthStore } from '@/stores/auth'

interface Santri {
  id: string
  nama_lengkap: string
  nis?: string
  kelas_nama?: string
}

interface Perizinan {
  id: string
  santri_id: string
  santri_nama: string
  tanggal_keluar: string
  perkiraan_kembali: string | null
  tanggal_kembali_aktual: string | null
  alasan: string
  status: 'diajukan' | 'disetujui' | 'ditolak' | 'selesai'
  diajukan_oleh_nama?: string
  disetujui_oleh_nama?: string
  catatan_keputusan?: string | null
}

const auth = useAuthStore()

const list = ref<Perizinan[]>([])
const loading = ref(true)
const error = ref('')
const activeTab = ref<'diajukan' | 'disetujui' | 'ditolak' | 'selesai' | ''>('')

const tabs: { key: typeof activeTab.value; label: string }[] = [
  { key: '', label: 'Semua' },
  { key: 'diajukan', label: 'Diajukan' },
  { key: 'disetujui', label: 'Disetujui' },
  { key: 'ditolak', label: 'Ditolak' },
  { key: 'selesai', label: 'Selesai' }
]

const canApprove = computed(() => auth.user?.role === 'admin' || auth.user?.role === 'kepala_asrama')

// Ajukan modal
const showAjukan = ref(false)
const ajukanSubmitting = ref(false)
const ajukanError = ref('')
const santriList = ref<Santri[]>([])
const santriSearch = ref('')
const santriDropdownOpen = ref(false)
const today = new Date().toISOString().slice(0, 10)
const ajukanForm = reactive({ santri_id: '', tanggal_keluar: today, perkiraan_kembali: '', alasan: '' })

const selectedSantri = computed(() => santriList.value.find((s) => s.id === ajukanForm.santri_id))
const filteredSantri = computed(() => {
  if (!santriSearch.value) return santriList.value.slice(0, 50)
  const q = santriSearch.value.toLowerCase()
  return santriList.value.filter((s) => s.nama_lengkap.toLowerCase().includes(q) || (s.nis ?? '').toLowerCase().includes(q)).slice(0, 50)
})

const santriDropdownRef = ref<HTMLElement | null>(null)
function handleOutsideClick(e: MouseEvent) {
  if (santriDropdownOpen.value && santriDropdownRef.value && !santriDropdownRef.value.contains(e.target as Node)) {
    santriDropdownOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', handleOutsideClick))
onUnmounted(() => document.removeEventListener('click', handleOutsideClick))

function selectSantri(s: Santri) {
  ajukanForm.santri_id = s.id
  santriSearch.value = ''
  santriDropdownOpen.value = false
}

// Tolak modal
const tolakTarget = ref<Perizinan | null>(null)
const tolakAlasan = ref('')
const tolakSubmitting = ref(false)
const tolakError = ref('')

const statusBadge: Record<string, string> = {
  diajukan: 'bg-amber-100 text-amber-800',
  disetujui: 'bg-sky-100 text-sky-800',
  ditolak: 'bg-red-100 text-red-800',
  selesai: 'bg-emerald-100 text-emerald-800'
}
const statusLabel: Record<string, string> = {
  diajukan: 'Diajukan',
  disetujui: 'Disetujui',
  ditolak: 'Ditolak',
  selesai: 'Selesai'
}

function formatDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function fetchList() {
  loading.value = true
  error.value = ''
  try {
    list.value = await perizinanService.list({ status: activeTab.value || undefined })
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat data perizinan'
  } finally {
    loading.value = false
  }
}

function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
  fetchList()
}

async function fetchSantri() {
  try {
    const res = await santriService.list({ limit: 500, status: 'aktif' })
    santriList.value = res.data ?? []
  } catch {
    santriList.value = []
  }
}

function openAjukan() {
  ajukanError.value = ''
  ajukanForm.santri_id = ''
  ajukanForm.tanggal_keluar = today
  ajukanForm.perkiraan_kembali = ''
  ajukanForm.alasan = ''
  showAjukan.value = true
}

async function submitAjukan() {
  if (!ajukanForm.santri_id) {
    ajukanError.value = 'Santri harus dipilih'
    return
  }
  if (!ajukanForm.alasan.trim()) {
    ajukanError.value = 'Alasan wajib diisi'
    return
  }
  ajukanSubmitting.value = true
  try {
    await perizinanService.ajukan({
      santri_id: ajukanForm.santri_id,
      tanggal_keluar: ajukanForm.tanggal_keluar,
      perkiraan_kembali: ajukanForm.perkiraan_kembali || undefined,
      alasan: ajukanForm.alasan
    })
    showAjukan.value = false
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    ajukanError.value = err?.response?.data?.message || 'Gagal mengajukan izin'
  } finally {
    ajukanSubmitting.value = false
  }
}

async function doApprove(p: Perizinan) {
  try {
    await perizinanService.approve(p.id)
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menyetujui perizinan'
  }
}

function openTolak(p: Perizinan) {
  tolakError.value = ''
  tolakAlasan.value = ''
  tolakTarget.value = p
}

async function submitTolak() {
  if (!tolakTarget.value) return
  if (!tolakAlasan.value.trim()) {
    tolakError.value = 'Alasan penolakan wajib diisi'
    return
  }
  tolakSubmitting.value = true
  try {
    await perizinanService.tolak(tolakTarget.value.id, tolakAlasan.value)
    tolakTarget.value = null
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    tolakError.value = err?.response?.data?.message || 'Gagal menolak perizinan'
  } finally {
    tolakSubmitting.value = false
  }
}

async function doKembali(p: Perizinan) {
  try {
    await perizinanService.kembali(p.id)
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menandai kembali'
  }
}

async function doBatalkan(p: Perizinan) {
  if (!confirm('Batalkan pengajuan izin ini?')) return
  try {
    await perizinanService.batalkan(p.id)
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal membatalkan perizinan'
  }
}

onMounted(() => {
  fetchList()
  fetchSantri()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Perizinan Pulang</h1>
        <p class="text-sm text-gray-500">Izin keluar asrama/pulang kampung santri</p>
      </div>
      <button
        v-if="!auth.isReadOnly"
        type="button"
        @click="openAjukan"
        class="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
      >
        + Ajukan Izin
      </button>
    </div>

    <div class="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="[
          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition',
          activeTab === tab.key ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        ]"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="h-24 animate-pulse rounded-xl bg-gray-100"></div>
    </div>

    <div
      v-else-if="list.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"
    >
      <p class="text-sm font-medium text-gray-600">Belum ada perizinan</p>
    </div>

    <div v-else class="space-y-3">
      <div v-for="p in list" :key="p.id" class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-gray-900">{{ p.santri_nama }}</p>
              <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusBadge[p.status]]">{{ statusLabel[p.status] }}</span>
            </div>
            <p class="mt-1 text-sm text-gray-600">{{ p.alasan }}</p>
            <p class="mt-1 text-xs text-gray-400">
              Keluar {{ formatDate(p.tanggal_keluar) }}
              <span v-if="p.perkiraan_kembali"> · perkiraan kembali {{ formatDate(p.perkiraan_kembali) }}</span>
              <span v-if="p.tanggal_kembali_aktual"> · kembali {{ formatDate(p.tanggal_kembali_aktual) }}</span>
            </p>
            <p v-if="p.diajukan_oleh_nama" class="mt-1 text-xs italic text-gray-400">Diajukan oleh {{ p.diajukan_oleh_nama }}</p>
            <p v-if="p.catatan_keputusan" class="mt-1 text-xs text-gray-500">Catatan: {{ p.catatan_keputusan }}</p>
          </div>

          <div class="flex shrink-0 flex-wrap gap-2">
            <template v-if="p.status === 'diajukan'">
              <button
                v-if="canApprove"
                type="button"
                @click="doApprove(p)"
                class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
              >
                Setujui
              </button>
              <button
                v-if="canApprove"
                type="button"
                @click="openTolak(p)"
                class="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
              >
                Tolak
              </button>
              <button
                v-if="!auth.isReadOnly"
                type="button"
                @click="doBatalkan(p)"
                class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Batalkan
              </button>
            </template>
            <template v-else-if="p.status === 'disetujui'">
              <button
                v-if="!auth.isReadOnly"
                type="button"
                @click="doKembali(p)"
                class="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700"
              >
                Tandai Kembali
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showAjukan"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="showAjukan = false"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Ajukan Izin Pulang</h2>
        <div v-if="ajukanError" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ ajukanError }}</div>

        <div class="space-y-4">
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
                    <span v-if="s.kelas_nama" class="block text-xs text-gray-400">{{ s.kelas_nama }}</span>
                  </button>
                  <p v-if="filteredSantri.length === 0" class="px-3 py-4 text-center text-sm text-gray-400">Santri tidak ditemukan</p>
                </div>
              </div>
            </div>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Tanggal Keluar</label>
            <input v-model="ajukanForm.tanggal_keluar" type="date" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Perkiraan Kembali (opsional)</label>
            <input v-model="ajukanForm.perkiraan_kembali" type="date" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Alasan <span class="text-red-500">*</span></label>
            <textarea v-model="ajukanForm.alasan" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"></textarea>
          </div>
        </div>

        <div class="mt-6 flex gap-3">
          <button
            type="button"
            :disabled="ajukanSubmitting"
            @click="submitAjukan"
            class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {{ ajukanSubmitting ? 'Mengajukan...' : 'Ajukan' }}
          </button>
          <button
            type="button"
            @click="showAjukan = false"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Batal
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="tolakTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="tolakTarget = null"
    >
      <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-1 text-lg font-semibold text-gray-900">Tolak Perizinan</h2>
        <p class="mb-4 text-sm text-gray-500">Untuk <strong>{{ tolakTarget.santri_nama }}</strong></p>
        <div v-if="tolakError" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ tolakError }}</div>
        <div class="mb-4">
          <label class="mb-1 block text-sm font-medium text-gray-700">Alasan Penolakan <span class="text-red-500">*</span></label>
          <textarea v-model="tolakAlasan" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"></textarea>
        </div>
        <div class="flex gap-3">
          <button
            type="button"
            :disabled="tolakSubmitting"
            @click="submitTolak"
            class="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {{ tolakSubmitting ? 'Memproses...' : 'Tolak' }}
          </button>
          <button
            type="button"
            @click="tolakTarget = null"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

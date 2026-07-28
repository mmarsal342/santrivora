<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useEntityList } from '@/offline/composables/useEntityList'
import { useEntityMutation } from '@/offline/composables/useEntityMutation'

interface Santri {
  id: string
  nama_lengkap: string
  status: string
  kelas_id: string | null
}

interface Kelas {
  id: string
  nama: string
}

interface SantriOption {
  id: string
  nama_lengkap: string
  kelas_nama?: string
}

// diajukan_oleh_nama/disetujui_oleh_nama SENGAJA DIHILANGKAN dari tampilan —
// alasan sama seperti dicatat_oleh_nama di catatan_disiplin/perkembangan:
// users/personel gak pernah masuk sync cache (permanen), gak ada cara
// resolve nama ini client-side utk semua role.
interface Perizinan {
  id: string
  santri_id: string
  tanggal_keluar: string
  perkiraan_kembali: string | null
  tanggal_kembali_aktual: string | null
  alasan: string
  status: 'diajukan' | 'disetujui' | 'ditolak' | 'selesai'
  catatan_keputusan?: string | null
  is_deleted?: number
}

const auth = useAuthStore()

const { allItems: allSantri } = useEntityList<Santri>('santri')
const { allItems: kelasList } = useEntityList<Kelas>('kelas')
const kelasNameById = computed(() => new Map(kelasList.value.map((k) => [k.id, k.nama])))
const santriNameById = computed(() => new Map(allSantri.value.map((s) => [s.id, s.nama_lengkap])))

const activeTab = ref<'diajukan' | 'disetujui' | 'ditolak' | 'selesai' | ''>('')

const tabs: { key: typeof activeTab.value; label: string }[] = [
  { key: '', label: 'Semua' },
  { key: 'diajukan', label: 'Diajukan' },
  { key: 'disetujui', label: 'Disetujui' },
  { key: 'ditolak', label: 'Ditolak' },
  { key: 'selesai', label: 'Selesai' }
]

const {
  items: list,
  loading,
  hasMoreLocal,
  loadMore,
  resetWindow
} = useEntityList<Perizinan>('perizinan_pulang', {
  filter: (p) => {
    if (p.is_deleted) return false
    if (activeTab.value && p.status !== activeTab.value) return false
    return true
  },
  sort: (a, b) => b.tanggal_keluar.localeCompare(a.tanggal_keluar),
  pageSize: 20
})

const mutation = useEntityMutation<Perizinan>('perizinan_pulang')
const error = ref('')

function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
  resetWindow()
}

const canApprove = computed(() => auth.user?.role === 'admin' || auth.user?.role === 'kepala_asrama')

// Ajukan modal — santri dari cache (aktif saja), kelas_nama di-resolve dari
// cache kelas (dulu JOIN server via santriService.list network).
const showAjukan = ref(false)
const ajukanSubmitting = ref(false)
const ajukanError = ref('')
const santriSearch = ref('')
const santriDropdownOpen = ref(false)
const today = new Date().toISOString().slice(0, 10)
const ajukanForm = reactive({ santri_id: '', tanggal_keluar: today, perkiraan_kembali: '', alasan: '' })

const santriOptions = computed<SantriOption[]>(() =>
  allSantri.value
    .filter((s) => s.status === 'aktif')
    .map((s) => ({ id: s.id, nama_lengkap: s.nama_lengkap, kelas_nama: s.kelas_id ? kelasNameById.value.get(s.kelas_id) : undefined }))
)

const selectedSantri = computed(() => santriOptions.value.find((s) => s.id === ajukanForm.santri_id))
const filteredSantri = computed(() => {
  if (!santriSearch.value) return santriOptions.value.slice(0, 50)
  const q = santriSearch.value.toLowerCase()
  return santriOptions.value.filter((s) => s.nama_lengkap.toLowerCase().includes(q)).slice(0, 50)
})

const santriDropdownRef = ref<HTMLElement | null>(null)
function handleOutsideClick(e: MouseEvent) {
  if (santriDropdownOpen.value && santriDropdownRef.value && !santriDropdownRef.value.contains(e.target as Node)) {
    santriDropdownOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', handleOutsideClick))
onUnmounted(() => document.removeEventListener('click', handleOutsideClick))

function selectSantri(s: SantriOption) {
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
    await mutation.create({
      santri_id: ajukanForm.santri_id,
      tanggal_keluar: ajukanForm.tanggal_keluar,
      perkiraan_kembali: ajukanForm.perkiraan_kembali || undefined,
      alasan: ajukanForm.alasan,
      // 'status' bukan bagian createSchema backend (di-strip diam-diam sama
      // zod, harmless — backend selalu pakai DB DEFAULT 'diajukan') TAPI
      // tetap WAJIB disertakan di sini buat baris cache lokal optimistic:
      // create() cuma nyimpen field yang dikirim persis apa adanya, gak ada
      // mekanisme "isi otomatis dari DB DEFAULT" di sisi client (DEFAULT itu
      // baru kebaca lagi setelah pull berikutnya). Tanpa ini, badge status +
      // tombol Setujui/Tolak/Batalkan kosong sampai push berhasil sync.
      status: 'diajukan'
    })
    showAjukan.value = false
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    ajukanError.value = err?.response?.data?.message || 'Gagal mengajukan izin'
  } finally {
    ajukanSubmitting.value = false
  }
}

async function doApprove(p: Perizinan) {
  try {
    await mutation.update(p.id, { status: 'disetujui' })
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
    await mutation.update(tolakTarget.value.id, { status: 'ditolak', catatan_keputusan: tolakAlasan.value.trim() })
    tolakTarget.value = null
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    tolakError.value = err?.response?.data?.message || 'Gagal menolak perizinan'
  } finally {
    tolakSubmitting.value = false
  }
}

async function doKembali(p: Perizinan) {
  try {
    // Kirim tanggal hari ini EKSPLISIT dari client — beda dari REST
    // /kembali lama yang nge-default ke server 'today' kalau field ini
    // diomit; engine sync generik gak punya mekanisme default-if-omitted
    // buat writeFields transisi (field yang undefined cuma di-skip dari SET,
    // bukan di-isi otomatis), jadi client yang isi biar gak nyisa NULL.
    await mutation.update(p.id, { status: 'selesai', tanggal_kembali_aktual: new Date().toISOString().slice(0, 10) })
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menandai kembali'
  }
}

async function doBatalkan(p: Perizinan) {
  if (!confirm('Batalkan pengajuan izin ini?')) return
  try {
    await mutation.remove(p.id)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal membatalkan perizinan'
  }
}
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
              <p class="font-semibold text-gray-900">{{ santriNameById.get(p.santri_id) ?? '-' }}</p>
              <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusBadge[p.status]]">{{ statusLabel[p.status] }}</span>
            </div>
            <p class="mt-1 text-sm text-gray-600">{{ p.alasan }}</p>
            <p class="mt-1 text-xs text-gray-400">
              Keluar {{ formatDate(p.tanggal_keluar) }}
              <span v-if="p.perkiraan_kembali"> · perkiraan kembali {{ formatDate(p.perkiraan_kembali) }}</span>
              <span v-if="p.tanggal_kembali_aktual"> · kembali {{ formatDate(p.tanggal_kembali_aktual) }}</span>
            </p>
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

    <div v-if="hasMoreLocal" class="flex justify-center">
      <button
        type="button"
        @click="loadMore"
        class="inline-flex items-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
      >
        Muat Lebih Banyak
      </button>
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
                    placeholder="Cari nama santri..."
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
        <p class="mb-4 text-sm text-gray-500">Untuk <strong>{{ santriNameById.get(tolakTarget.santri_id) ?? '-' }}</strong></p>
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

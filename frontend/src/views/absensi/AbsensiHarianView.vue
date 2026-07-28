<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { kegiatanService, absensiService } from '@/services'
import { useEntityList } from '@/offline/composables/useEntityList'
import { pullAll } from '@/offline/sync/engine'

interface Kamar {
  id: string
  nama: string
  jenis_kelamin: 'L' | 'P'
  is_active?: number
}

interface Kegiatan {
  id: string
  nama: string
  jenis?: string
}

interface SantriCache {
  id: string
  nama_lengkap: string
  kamar_id: string | null
  status: string
}

interface AbsensiCache {
  santri_id: string
  tanggal: string
  kegiatan_id: string | null
  status: 'hadir' | 'sakit' | 'izin' | 'alpa'
  keterangan?: string | null
}

interface SantriRow {
  id: string
  nama_lengkap: string
  status: 'hadir' | 'sakit' | 'izin' | 'alpa'
  keterangan: string
}

type AbsensiStatus = 'hadir' | 'sakit' | 'izin' | 'alpa'

import EmptyState from '@/components/EmptyState.vue'

const statusOptions: Array<{ value: AbsensiStatus; label: string; short: string; activeClass: string; dot: string }> = [
  { value: 'hadir', label: 'Hadir', short: 'H', activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-emerald-500/20', dot: 'bg-emerald-500' },
  { value: 'sakit', label: 'Sakit', short: 'S', activeClass: 'border-amber-500 bg-amber-50 text-amber-700 ring-amber-500/20', dot: 'bg-amber-500' },
  { value: 'izin', label: 'Izin', short: 'I', activeClass: 'border-sky-500 bg-sky-50 text-sky-700 ring-sky-500/20', dot: 'bg-sky-500' },
  { value: 'alpa', label: 'Alpa', short: 'A', activeClass: 'border-rose-500 bg-rose-50 text-rose-700 ring-rose-500/20', dot: 'bg-rose-500' },
]

const auth = useAuthStore()
const route = useRoute()

// kamar & santri sudah ke-cache (pull-only/push-eligible) — dropdown kamar
// dan roster santri baca dari sana, instan & jalan offline. absensi yang
// SUDAH tercatat juga dari cache (pull-only di gelombang ini, lihat
// offline/entities/absensi.config.ts). kegiatanList TETAP network langsung
// (kegiatanService.list({tanggal})) — itu yang men-trigger materialize
// instance kegiatan dari jadwal_kegiatan di server (side-effect nyata, cuma
// terjadi lewat REST GET ini, BUKAN lewat /api/sync/pull) — kalau offline,
// try/catch di bawah sudah gracefully fallback ke [] seperti sebelumnya.
const { allItems: kamarOptions, loading: loadingKamar } = useEntityList<Kamar>('kamar')
const { allItems: allSantri } = useEntityList<SantriCache>('santri')
const { allItems: allAbsensi } = useEntityList<AbsensiCache>('absensi')

const kamarList = computed(() => kamarOptions.value.filter((k) => k.is_active !== 0))
const kegiatanList = ref<Kegiatan[]>([])
const selectedKamar = ref('')
const selectedKegiatan = ref('') // '' = absensi harian umum
const tanggal = ref(new Date().toISOString().slice(0, 10))

const santriRows = ref<SantriRow[]>([])

const submitting = ref(false)
const error = ref('')
const successMessage = ref('')

const showKamarPicker = computed(() => kamarList.value.length > 1 || auth.isAdmin)

// Auto-pilih kamar kalau cuma ada satu — sekali aja pas cache pertama kali
// kebaca (mirror pola auto-pilih di SantriFormView).
let autoKamarPicked = false
watch(kamarList, (opts) => {
  if (autoKamarPicked || selectedKamar.value) return
  if (opts.length === 1) {
    autoKamarPicked = true
    selectedKamar.value = opts[0].id
  }
}, { immediate: true })

async function loadKegiatan() {
  if (!selectedKamar.value) {
    kegiatanList.value = []
    return
  }
  try {
    kegiatanList.value = await kegiatanService.list({ tanggal: tanggal.value })
    const queryKegiatanId = route.query.kegiatan_id as string
    if (queryKegiatanId && kegiatanList.value.some((g) => g.id === queryKegiatanId)) {
      selectedKegiatan.value = queryKegiatanId
    }
  } catch {
    kegiatanList.value = []
  }
}

// Roster (baca) sekarang SEPENUHNYA dari cache Dexie, sinkron (bukan async
// fetch) — rosterGen (workaround race pemanggilan network bertumpuk) gak
// diperlukan lagi sama sekali, tinggal re-seed langsung tiap seleksi
// kamar/tanggal/kegiatan berubah. SENGAJA cuma re-seed di titik itu (bukan
// terus-menerus reaktif ke perubahan cache lain) — biar background pull gak
// diam-diam nimpa status/keterangan yang lagi diedit user buat kamar/tanggal
// yang SAMA.
function loadRoster() {
  error.value = ''
  successMessage.value = ''
  if (!selectedKamar.value) {
    santriRows.value = []
    return
  }
  const kegiatanId = selectedKegiatan.value || null
  const existingMap = new Map(
    allAbsensi.value
      .filter((a) => a.tanggal === tanggal.value && (a.kegiatan_id ?? null) === kegiatanId)
      .map((a) => [a.santri_id, a])
  )
  santriRows.value = allSantri.value
    .filter((s) => s.kamar_id === selectedKamar.value && s.status === 'aktif')
    .map((s) => {
      const existing = existingMap.get(s.id)
      return {
        id: s.id,
        nama_lengkap: s.nama_lengkap,
        status: existing?.status ?? 'hadir',
        keterangan: existing?.keterangan ?? ''
      }
    })
}

function setAllHadir() {
  santriRows.value.forEach((s) => { s.status = 'hadir' })
}

const summaryCounts = computed(() => {
  const counts: Record<AbsensiStatus, number> = { hadir: 0, sakit: 0, izin: 0, alpa: 0 }
  santriRows.value.forEach((s) => { counts[s.status]++ })
  return counts
})

async function submit() {
  if (!selectedKamar.value || santriRows.value.length === 0) return
  submitting.value = true
  error.value = ''
  successMessage.value = ''
  try {
    const payload = {
      tanggal: tanggal.value,
      kegiatan_id: selectedKegiatan.value || undefined,
      items: santriRows.value.map((s) => ({
        santri_id: s.id,
        status: s.status,
        keterangan: s.keterangan.trim() || undefined
      }))
    }
    const result = await absensiService.bulkMark(payload)
    successMessage.value = `${result.success}/${result.total} absensi berhasil disimpan.`
    // bulkMark tetap network langsung (aksi batch sadar sekali-klik, bukan
    // aliran mutasi independen) — refresh cache absensi lokal sesudahnya
    // biar liveQuery lain (kalau ada) ikut lihat data terbaru.
    pullAll().catch(() => {})
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menyimpan absensi.'
  } finally {
    submitting.value = false
  }
}

watch(selectedKamar, () => {
  selectedKegiatan.value = ''
  loadKegiatan()
  loadRoster()
})
watch(tanggal, () => {
  selectedKegiatan.value = ''
  loadKegiatan()
  loadRoster()
})
watch(selectedKegiatan, () => {
  loadRoster()
})

onMounted(() => {
  if (selectedKamar.value) {
    loadKegiatan()
    loadRoster()
  }
})
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Absen Hari Ini</h1>
      <p class="text-sm text-slate-500 mt-1">Tandai kehadiran santri di kamar Anda — default Hadir, tinggal ubah yang perlu.</p>
    </div>

    <!-- Selector bar -->
    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div v-if="showKamarPicker">
          <label class="mb-1 block text-xs font-medium text-slate-600">Kamar</label>
          <select
            v-model="selectedKamar"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
          >
            <option value="">Pilih kamar...</option>
            <option v-for="k in kamarList" :key="k.id" :value="k.id">{{ k.nama }}</option>
          </select>
        </div>
        <div v-else-if="kamarList.length === 1" class="sm:col-span-1">
          <label class="mb-1 block text-xs font-medium text-slate-600">Kamar</label>
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            {{ kamarList[0].nama }}
          </div>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-600">Tanggal</label>
          <input
            v-model="tanggal"
            type="date"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-600">Kegiatan (opsional)</label>
          <select
            v-model="selectedKegiatan"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
          >
            <option value="">Absensi harian (umum)</option>
            <option v-for="g in kegiatanList" :key="g.id" :value="g.id">{{ g.nama }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- No kamar assigned -->
    <EmptyState
      v-if="!loadingKamar && kamarList.length === 0"
      title="Anda belum ditugaskan sebagai wali kamar"
      description="Hubungi admin untuk assignment kamar."
    />

    <template v-else-if="selectedKamar">
      <!-- Error / success -->
      <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ error }}</div>
      <div v-if="successMessage" class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{{ successMessage }}</div>

      <!-- Summary + actions -->
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap gap-4 text-sm">
          <span class="font-medium text-slate-600">{{ santriRows.length }} santri</span>
          <span class="text-emerald-700">Hadir {{ summaryCounts.hadir }}</span>
          <span class="text-amber-700">Sakit {{ summaryCounts.sakit }}</span>
          <span class="text-sky-700">Izin {{ summaryCounts.izin }}</span>
          <span class="text-rose-700">Alpa {{ summaryCounts.alpa }}</span>
        </div>
        <button
          type="button"
          @click="setAllHadir"
          class="text-xs font-medium text-slate-500 hover:text-emerald-700"
        >Set semua Hadir</button>
      </div>

      <!-- Roster (baca dari cache, instan — gak ada loading state async lagi) -->
      <div v-if="santriRows.length" class="space-y-2">
        <div
          v-for="s in santriRows"
          :key="s.id"
          class="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs transition hover:shadow-sm sm:p-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                {{ s.nama_lengkap.charAt(0).toUpperCase() }}
              </div>
              <span class="font-medium text-slate-800">{{ s.nama_lengkap }}</span>
            </div>
            <div class="flex gap-1.5">
              <button
                v-for="opt in statusOptions"
                :key="opt.value"
                type="button"
                @click="s.status = opt.value"
                :title="opt.label"
                class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition sm:px-3"
                :class="s.status === opt.value ? opt.activeClass + ' ring-1' : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
              >
                <span class="h-1.5 w-1.5 rounded-full" :class="opt.dot"></span>
                <span class="hidden sm:inline">{{ opt.label }}</span>
                <span class="sm:hidden">{{ opt.short }}</span>
              </button>
            </div>
          </div>
          <div v-if="s.status !== 'hadir'" class="mt-2.5 grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] sm:flex sm:items-center">
            <span class="text-xs font-medium text-slate-400 sm:w-20">Keterangan</span>
            <input
              v-model="s.keterangan"
              type="text"
              placeholder="Keterangan tambahan (opsional)..."
              class="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>
      </div>

      <EmptyState
        v-else
        title="Belum ada santri aktif di kamar ini"
        description="Tambahkan santri terlebih dahulu untuk melakukan absensi."
      />

      <!-- Submit -->
      <div v-if="santriRows.length" class="sticky bottom-4 flex justify-end">
        <button
          type="button"
          :disabled="submitting"
          @click="submit"
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50"
        >
          <svg v-if="submitting" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          {{ submitting ? 'Menyimpan...' : 'Simpan Absensi' }}
        </button>
      </div>
    </template>

    <div v-else-if="!loadingKamar" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p class="text-sm text-slate-500">Pilih kamar terlebih dahulu.</p>
    </div>
  </div>
</template>

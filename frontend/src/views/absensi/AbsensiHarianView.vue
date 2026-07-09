<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { kamarService, kegiatanService, santriService, absensiService } from '@/services'

interface Kamar {
  id: string
  nama: string
  jenis_kelamin: 'L' | 'P'
  jumlah_santri?: number
}

interface Kegiatan {
  id: string
  nama: string
  jenis?: string
}

interface SantriRow {
  id: string
  nama_lengkap: string
  status: 'hadir' | 'sakit' | 'izin' | 'alpa'
  keterangan: string
}

type AbsensiStatus = 'hadir' | 'sakit' | 'izin' | 'alpa'

const statusOptions: Array<{ value: AbsensiStatus; label: string; activeClass: string }> = [
  { value: 'hadir', label: 'Hadir', activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
  { value: 'sakit', label: 'Sakit', activeClass: 'border-amber-500 bg-amber-50 text-amber-700' },
  { value: 'izin', label: 'Izin', activeClass: 'border-sky-500 bg-sky-50 text-sky-700' },
  { value: 'alpa', label: 'Alpa', activeClass: 'border-rose-500 bg-rose-50 text-rose-700' },
]

const auth = useAuthStore()
const route = useRoute()

const kamarList = ref<Kamar[]>([])
const kegiatanList = ref<Kegiatan[]>([])
const selectedKamar = ref('')
const selectedKegiatan = ref('') // '' = absensi harian umum
const tanggal = ref(new Date().toISOString().slice(0, 10))

const santriRows = ref<SantriRow[]>([])

const loadingKamar = ref(true)
const loadingRoster = ref(false)
const submitting = ref(false)
const error = ref('')
const successMessage = ref('')

const showKamarPicker = computed(() => kamarList.value.length > 1 || auth.isAdmin)

async function loadKamar() {
  loadingKamar.value = true
  try {
    kamarList.value = await kamarService.list()
    if (kamarList.value.length === 1) {
      selectedKamar.value = kamarList.value[0].id
    }
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat daftar kamar.'
  } finally {
    loadingKamar.value = false
  }
}

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

let rosterGen = 0

async function loadRoster() {
  if (!selectedKamar.value) {
    santriRows.value = []
    return
  }
  const myGen = ++rosterGen
  loadingRoster.value = true
  error.value = ''
  successMessage.value = ''
  try {
    const [res, existingRes] = await Promise.all([
      santriService.list({ kamar_id: selectedKamar.value, status: 'aktif', limit: 200 }),
      absensiService.list({
        kamar_id: selectedKamar.value,
        tanggal: tanggal.value,
        kegiatan_id: selectedKegiatan.value || undefined,
        limit: 200
      })
    ])
    if (myGen !== rosterGen) return // stale response, ignore
    const santriData = (res.data ?? []) as Array<{ id: string; nama_lengkap: string }>
    const existingList = (existingRes.data ?? []) as Array<{ santri_id: string; status: AbsensiStatus; keterangan?: string }>
    const existingMap = new Map(existingList.map((a) => [a.santri_id, a]))

    santriRows.value = santriData.map((s) => {
      const existing = existingMap.get(s.id)
      return {
        id: s.id,
        nama_lengkap: s.nama_lengkap,
        status: existing?.status ?? 'hadir',
        keterangan: existing?.keterangan ?? ''
      }
    })
  } catch (e: unknown) {
    if (myGen !== rosterGen) return
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat daftar santri.'
    santriRows.value = []
  } finally {
    if (myGen === rosterGen) loadingRoster.value = false
  }
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
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menyimpan absensi.'
  } finally {
    submitting.value = false
  }
}

watch(selectedKamar, () => {
  loadKegiatan()
  loadRoster()
})
watch(tanggal, () => {
  loadKegiatan()
  loadRoster()
})
watch(selectedKegiatan, () => {
  loadRoster()
})

onMounted(loadKamar)
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
    <div
      v-if="!loadingKamar && kamarList.length === 0"
      class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"
    >
      <p class="text-sm font-medium text-slate-600">Anda belum ditugaskan sebagai wali kamar manapun.</p>
      <p class="mt-1 text-sm text-slate-400">Hubungi admin untuk assignment kamar.</p>
    </div>

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

      <!-- Loading roster -->
      <div v-if="loadingRoster" class="space-y-2">
        <div v-for="i in 5" :key="i" class="h-16 animate-pulse rounded-xl bg-slate-100"></div>
      </div>

      <!-- Roster -->
      <div v-else-if="santriRows.length" class="space-y-2">
        <div
          v-for="s in santriRows"
          :key="s.id"
          class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                {{ s.nama_lengkap.charAt(0).toUpperCase() }}
              </div>
              <span class="font-medium text-slate-800">{{ s.nama_lengkap }}</span>
            </div>
            <div class="grid grid-cols-4 gap-1.5">
              <button
                v-for="opt in statusOptions"
                :key="opt.value"
                type="button"
                @click="s.status = opt.value"
                class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
                :class="s.status === opt.value ? opt.activeClass : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
              >{{ opt.label }}</button>
            </div>
          </div>
          <div v-if="s.status !== 'hadir'" class="mt-2">
            <input
              v-model="s.keterangan"
              type="text"
              placeholder="Keterangan (opsional)..."
              class="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>
      </div>

      <div v-else class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p class="text-sm text-slate-500">Belum ada santri aktif di kamar ini.</p>
      </div>

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

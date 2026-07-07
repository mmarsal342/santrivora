<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { dashboardService } from '@/services'

interface DashboardSummary {
  totals: {
    santri: number
    kamar: number
    pelanggaran_30hari: number
    prestasi_30hari: number
  }
  per_kamar: Array<{
    nama: string
    pelanggaran: number
    prestasi: number
    jumlah_santri: number
  }>
  top_pelanggar: Array<{
    nama_lengkap: string
    kamar_nama: string
    total: number
  }>
}

interface WaliKamarSummary {
  id: string
  nama_lengkap: string
  email: string
  status: string
  assigned_kamar: Array<{ id: string; nama: string; jenis_kelamin: 'L' | 'P' }>
  catatan_haid_tercatat: number | null
  jumlah_santri: number
  absensi: { hadir: number; sakit: number; izin: number; alpa: number; tingkat_kehadiran_persen: number }
  disiplin: { pelanggaran: number; prestasi: number }
  santri_butuh_perhatian: Array<{ id: string; nama_lengkap: string; alasan: string }>
}

interface SantriDrilldown {
  id: string
  nama_lengkap: string
  absensi: { hadir: number; sakit: number; izin: number; alpa: number }
  pelanggaran_per_kategori: Array<{ kategori_id: string | null; kategori_nama: string; jumlah: number }>
  prestasi_per_jenis: Array<{ jenis_prestasi: string; jumlah: number }>
  prestasi_total: number
}

const auth = useAuthStore()
const summary = ref<DashboardSummary | null>(null)
const loading = ref(true)
const error = ref('')

const waliKamarList = ref<WaliKamarSummary[]>([])
const loadingWali = ref(true)
const waliError = ref('')
const selectedWaliId = ref('')
const periodDari = ref('')
const periodSampai = ref('')
const drilldownSantri = ref<SantriDrilldown[]>([])
const loadingDrilldown = ref(false)

const selectedWali = computed(() => waliKamarList.value.find((w) => w.id === selectedWaliId.value) || null)

const colorClasses: Record<string, { iconBg: string; iconText: string; value: string }> = {
  emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', value: 'text-emerald-700' },
  sky: { iconBg: 'bg-sky-50', iconText: 'text-sky-600', value: 'text-sky-700' },
  rose: { iconBg: 'bg-rose-50', iconText: 'text-rose-600', value: 'text-rose-700' },
  amber: { iconBg: 'bg-amber-50', iconText: 'text-amber-600', value: 'text-amber-700' },
}

const statCards = computed(() => {
  const t = summary.value?.totals
  if (!t) return []
  return [
    { label: 'Total Santri', value: t.santri, icon: 'users', color: 'emerald', desc: 'Santri terdaftar' },
    { label: 'Total Kamar', value: t.kamar, icon: 'academic', color: 'sky', desc: 'Kamar aktif' },
    { label: 'Pelanggaran 30 Hari', value: t.pelanggaran_30hari, icon: 'alert', color: 'rose', desc: 'Catatan terkini' },
    { label: 'Prestasi 30 Hari', value: t.prestasi_30hari, icon: 'star', color: 'amber', desc: 'Pencapaian santri' },
  ]
})

const assignedKamar = computed(() => auth.user?.assigned_kamar ?? [])

async function loadSummary() {
  loading.value = true
  error.value = ''
  try {
    summary.value = await dashboardService.summary()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat data dashboard.'
  } finally {
    loading.value = false
  }
}

async function loadDrilldown() {
  if (!selectedWaliId.value) {
    drilldownSantri.value = []
    return
  }
  loadingDrilldown.value = true
  try {
    const res = await dashboardService.perWaliKamarSantri(selectedWaliId.value, {
      dari: periodDari.value || undefined,
      sampai: periodSampai.value || undefined
    })
    drilldownSantri.value = res.data.santri
  } catch {
    drilldownSantri.value = []
  } finally {
    loadingDrilldown.value = false
  }
}

function selectWali(id: string) {
  selectedWaliId.value = id
  loadDrilldown()
}

async function loadWaliKamar() {
  loadingWali.value = true
  waliError.value = ''
  try {
    const params = periodDari.value && periodSampai.value
      ? { dari: periodDari.value, sampai: periodSampai.value }
      : undefined
    const res = await dashboardService.perWaliKamar(params)
    waliKamarList.value = res.data
    periodDari.value = res.period.dari
    periodSampai.value = res.period.sampai
    if (!selectedWaliId.value || !waliKamarList.value.some((w) => w.id === selectedWaliId.value)) {
      selectedWaliId.value = waliKamarList.value[0]?.id || ''
    }
    await loadDrilldown()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    waliError.value = err?.response?.data?.message || 'Gagal memuat rekap wali kamar.'
  } finally {
    loadingWali.value = false
  }
}

function applyPeriod() {
  loadWaliKamar()
}

onMounted(() => {
  loadSummary()
  loadWaliKamar()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p class="text-sm text-slate-500 mt-1">
          Selamat datang kembali, {{ auth.user?.nama_lengkap ?? 'Pengguna' }}.
        </p>
      </div>
      <button
        v-if="auth.isAdmin"
        @click="loadSummary"
        :disabled="loading"
        class="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <svg class="h-4 w-4" :class="{ 'animate-spin': loading }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Muat ulang
      </button>
    </div>

    <!-- Ustadz welcome -->
    <div v-if="auth.isUstadz" class="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-6">
      <div class="flex items-start gap-4">
        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <svg class="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
          </svg>
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-emerald-900">Assalamu'alaikum, {{ auth.user?.nama_lengkap }}</h2>
          <p class="text-sm text-emerald-700 mt-1">
            Anda terdaftar sebagai ustadz pembimbing. Berikut kamar yang ditugaskan kepada Anda.
          </p>
          <div v-if="assignedKamar.length" class="mt-3 flex flex-wrap gap-2">
            <span
              v-for="k in assignedKamar"
              :key="k.id"
              class="inline-flex items-center rounded-full bg-white px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200"
            >
              {{ k.nama }}
              <span class="ml-1 text-emerald-400">· {{ k.jenis_kelamin === 'P' ? 'Putri' : 'Putra' }}</span>
            </span>
          </div>
          <p v-else class="mt-3 text-sm text-emerald-600 italic">Belum ada kamar yang ditugaskan.</p>
        </div>
      </div>
    </div>

    <!-- Admin dashboard -->
    <template v-if="auth.isAdmin">
      <!-- Error -->
      <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {{ error }}
      </div>

      <!-- Stat cards -->
      <div v-if="loading && !summary" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="i in 4" :key="i" class="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
          <div class="h-10 w-10 rounded-lg bg-slate-200"></div>
          <div class="mt-4 h-7 w-20 rounded bg-slate-200"></div>
          <div class="mt-2 h-4 w-32 rounded bg-slate-100"></div>
        </div>
      </div>

      <dl v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="card in statCards"
          :key="card.label"
          class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
        >
          <div class="flex items-center gap-4">
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
              :class="colorClasses[card.color].iconBg + ' ' + colorClasses[card.color].iconText"
            >
              <svg v-if="card.icon === 'users'" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-3-3" />
              </svg>
              <svg v-else-if="card.icon === 'academic'" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
              <svg v-else-if="card.icon === 'alert'" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              <svg v-else class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l2.95 6.36L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.05-.91L12 2z" />
              </svg>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ card.label }}</dt>
              <dd class="mt-0.5 text-2xl font-bold" :class="colorClasses[card.color].value">{{ card.value.toLocaleString('id-ID') }}</dd>
            </div>
          </div>
          <p class="mt-3 text-xs text-slate-400">{{ card.desc }}</p>
        </div>
      </dl>

      <!-- Per kelas & top pelanggar -->
      <div v-if="summary" class="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <!-- Per kamar breakdown -->
        <section class="lg:col-span-3 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-100 px-5 py-4">
            <h2 class="text-base font-semibold text-slate-900">Rekap per Kamar</h2>
            <p class="text-xs text-slate-500 mt-0.5">Distribusi pelanggaran &amp; prestasi tiap kamar</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-100 text-sm">
              <thead class="bg-slate-50">
                <tr>
                  <th class="px-5 py-3 text-left font-semibold text-slate-600">Kamar</th>
                  <th class="px-5 py-3 text-center font-semibold text-slate-600">Santri</th>
                  <th class="px-5 py-3 text-center font-semibold text-slate-600">Pelanggaran</th>
                  <th class="px-5 py-3 text-center font-semibold text-slate-600">Prestasi</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                <tr v-for="k in summary.per_kamar" :key="k.nama" class="hover:bg-slate-50/60">
                  <td class="px-5 py-3 font-medium text-slate-800">{{ k.nama }}</td>
                  <td class="px-5 py-3 text-center text-slate-600">{{ k.jumlah_santri }}</td>
                  <td class="px-5 py-3 text-center">
                    <span class="inline-flex min-w-[2rem] justify-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">{{ k.pelanggaran }}</span>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="inline-flex min-w-[2rem] justify-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{{ k.prestasi }}</span>
                  </td>
                </tr>
                <tr v-if="!summary.per_kamar.length">
                  <td colspan="4" class="px-5 py-8 text-center text-slate-400">Belum ada data kamar.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Top pelanggar -->
        <section class="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-100 px-5 py-4">
            <h2 class="text-base font-semibold text-slate-900">Top Pelanggar</h2>
            <p class="text-xs text-slate-500 mt-0.5">10 santri dengan catatan pelanggaran terbanyak</p>
          </div>
          <ol class="divide-y divide-slate-50">
            <li
              v-for="(p, idx) in summary.top_pelanggar.slice(0, 10)"
              :key="p.nama_lengkap + idx"
              class="flex items-center gap-3 px-5 py-3"
            >
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                :class="idx < 3 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'"
              >{{ idx + 1 }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-slate-800">{{ p.nama_lengkap }}</p>
                <p class="truncate text-xs text-slate-500">{{ p.kamar_nama }}</p>
              </div>
              <span class="shrink-0 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">{{ p.total }}</span>
            </li>
            <li v-if="!summary.top_pelanggar.length" class="px-5 py-8 text-center text-sm text-slate-400">
              Tidak ada data pelanggaran.
            </li>
          </ol>
        </section>
      </div>

      <!-- Rekap per Wali Kamar -->
      <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-900">Rekap per Wali Kamar</h2>
            <p class="text-xs text-slate-500 mt-0.5">Kehadiran, disiplin, dan santri yang butuh diperhatikan per wali kamar</p>
          </div>
          <div class="flex flex-wrap items-end gap-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-600">Dari</label>
              <input
                v-model="periodDari"
                type="date"
                class="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-600">Sampai</label>
              <input
                v-model="periodSampai"
                type="date"
                class="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <button
              type="button"
              @click="applyPeriod"
              :disabled="loadingWali"
              class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >Terapkan</button>
          </div>
        </div>

        <div v-if="waliError" class="mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{{ waliError }}</div>

        <div v-if="loadingWali && !waliKamarList.length" class="space-y-2 p-5">
          <div v-for="i in 3" :key="i" class="h-10 animate-pulse rounded-lg bg-slate-100"></div>
        </div>

        <template v-else-if="waliKamarList.length">
          <!-- Tabs -->
          <div class="flex gap-1 overflow-x-auto border-b border-slate-100 px-5 py-2">
            <button
              v-for="w in waliKamarList"
              :key="w.id"
              type="button"
              @click="selectWali(w.id)"
              class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition"
              :class="selectedWaliId === w.id ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:bg-slate-50'"
            >{{ w.nama_lengkap }}</button>
          </div>

          <div v-if="selectedWali" class="space-y-5 p-5">
            <!-- Kamar chips -->
            <div class="flex flex-wrap items-center gap-2">
              <span
                v-for="k in selectedWali.assigned_kamar"
                :key="k.id"
                class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
              >
                {{ k.nama }}<span class="ml-1 text-slate-400">· {{ k.jenis_kelamin === 'P' ? 'Putri' : 'Putra' }}</span>
              </span>
              <span v-if="!selectedWali.assigned_kamar.length" class="text-xs italic text-slate-400">Belum ada kamar yang ditugaskan.</span>
            </div>

            <!-- Stat row -->
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div class="rounded-lg border border-slate-200 p-3">
                <p class="text-xs text-slate-500">Santri</p>
                <p class="mt-1 text-xl font-bold text-slate-800">{{ selectedWali.jumlah_santri }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 p-3">
                <p class="text-xs text-slate-500">Tingkat Hadir</p>
                <p class="mt-1 text-xl font-bold text-emerald-700">{{ selectedWali.absensi.tingkat_kehadiran_persen }}%</p>
              </div>
              <div class="rounded-lg border border-slate-200 p-3">
                <p class="text-xs text-slate-500">Pelanggaran</p>
                <p class="mt-1 text-xl font-bold text-rose-700">{{ selectedWali.disiplin.pelanggaran }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 p-3">
                <p class="text-xs text-slate-500">Prestasi</p>
                <p class="mt-1 text-xl font-bold text-amber-700">{{ selectedWali.disiplin.prestasi }}</p>
              </div>
            </div>

            <!-- Absensi breakdown -->
            <div class="flex flex-wrap gap-4 text-sm">
              <span class="text-emerald-700">Hadir {{ selectedWali.absensi.hadir }}</span>
              <span class="text-amber-700">Sakit {{ selectedWali.absensi.sakit }}</span>
              <span class="text-sky-700">Izin {{ selectedWali.absensi.izin }}</span>
              <span class="text-rose-700">Alpa {{ selectedWali.absensi.alpa }}</span>
              <span v-if="selectedWali.catatan_haid_tercatat !== null" class="text-slate-500">
                Catatan Haid Tercatat: {{ selectedWali.catatan_haid_tercatat }}
              </span>
            </div>

            <!-- Santri butuh perhatian -->
            <div v-if="selectedWali.santri_butuh_perhatian.length" class="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <p class="text-sm font-semibold text-rose-800">⚠ Santri yang butuh diperhatikan</p>
              <ul class="mt-2 space-y-1">
                <li v-for="s in selectedWali.santri_butuh_perhatian" :key="s.id" class="text-sm text-rose-700">
                  {{ s.nama_lengkap }} — <span class="text-rose-600">{{ s.alasan }}</span>
                </li>
              </ul>
            </div>

            <!-- Drilldown per santri -->
            <div>
              <h3 class="mb-2 text-sm font-semibold text-slate-700">Detail per Santri</h3>
              <div v-if="loadingDrilldown" class="space-y-2">
                <div v-for="i in 3" :key="i" class="h-10 animate-pulse rounded-lg bg-slate-100"></div>
              </div>
              <div v-else class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="min-w-full divide-y divide-slate-100 text-sm">
                  <thead class="bg-slate-50">
                    <tr>
                      <th class="px-4 py-2 text-left font-semibold text-slate-600">Santri</th>
                      <th class="px-4 py-2 text-center font-semibold text-slate-600">Hadir</th>
                      <th class="px-4 py-2 text-center font-semibold text-slate-600">Sakit</th>
                      <th class="px-4 py-2 text-center font-semibold text-slate-600">Izin</th>
                      <th class="px-4 py-2 text-center font-semibold text-slate-600">Alpa</th>
                      <th class="px-4 py-2 text-left font-semibold text-slate-600">Pelanggaran</th>
                      <th class="px-4 py-2 text-left font-semibold text-slate-600">Prestasi</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-50">
                    <tr v-for="s in drilldownSantri" :key="s.id" class="hover:bg-slate-50/60">
                      <td class="px-4 py-2 font-medium text-slate-800">{{ s.nama_lengkap }}</td>
                      <td class="px-4 py-2 text-center text-emerald-700">{{ s.absensi.hadir }}</td>
                      <td class="px-4 py-2 text-center text-amber-700">{{ s.absensi.sakit }}</td>
                      <td class="px-4 py-2 text-center text-sky-700">{{ s.absensi.izin }}</td>
                      <td class="px-4 py-2 text-center text-rose-700">{{ s.absensi.alpa }}</td>
                      <td class="px-4 py-2 text-slate-600">
                        <span v-if="!s.pelanggaran_per_kategori.length" class="text-slate-300">—</span>
                        <span
                          v-for="(p, i) in s.pelanggaran_per_kategori"
                          :key="(p.kategori_id ?? 'null') + i"
                          class="mr-1 inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                        >{{ p.kategori_nama }} ×{{ p.jumlah }}</span>
                      </td>
                      <td class="px-4 py-2 text-slate-600">
                        <span v-if="!s.prestasi_per_jenis.length" class="text-slate-300">—</span>
                        <span
                          v-for="(p, i) in s.prestasi_per_jenis"
                          :key="p.jenis_prestasi + i"
                          class="mr-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                        >{{ p.jenis_prestasi }} ×{{ p.jumlah }}</span>
                      </td>
                    </tr>
                    <tr v-if="!drilldownSantri.length">
                      <td colspan="7" class="px-4 py-8 text-center text-slate-400">Belum ada santri aktif di kamar ini.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="p-10 text-center text-sm text-slate-400">Belum ada ustadz yang terdaftar.</div>
      </section>
    </template>
  </div>
</template>

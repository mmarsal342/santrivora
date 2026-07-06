<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { dashboardService } from '@/services'

interface DashboardSummary {
  totals: {
    santri: number
    kelas: number
    pelanggaran_30hari: number
    prestasi_30hari: number
  }
  per_kelas: Array<{
    nama: string
    pelanggaran: number
    prestasi: number
    jumlah_santri: number
  }>
  top_pelanggar: Array<{
    nama_lengkap: string
    kelas_nama: string
    total: number
  }>
}

const auth = useAuthStore()
const summary = ref<DashboardSummary | null>(null)
const loading = ref(true)
const error = ref('')

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
    { label: 'Total Kelas', value: t.kelas, icon: 'academic', color: 'sky', desc: 'Kelas aktif' },
    { label: 'Pelanggaran 30 Hari', value: t.pelanggaran_30hari, icon: 'alert', color: 'rose', desc: 'Catatan terkini' },
    { label: 'Prestasi 30 Hari', value: t.prestasi_30hari, icon: 'star', color: 'amber', desc: 'Pencapaian santri' },
  ]
})

const assignedKelas = computed(() => auth.user?.assigned_kelas ?? [])

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

onMounted(loadSummary)
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
            Anda terdaftar sebagai ustadz pembimbing. Berikut kelas yang ditugaskan kepada Anda.
          </p>
          <div v-if="assignedKelas.length" class="mt-3 flex flex-wrap gap-2">
            <span
              v-for="k in assignedKelas"
              :key="k.id"
              class="inline-flex items-center rounded-full bg-white px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200"
            >
              {{ k.nama }}
              <span v-if="k.tingkatan" class="ml-1 text-emerald-400">· {{ k.tingkatan }}</span>
            </span>
          </div>
          <p v-else class="mt-3 text-sm text-emerald-600 italic">Belum ada kelas yang ditugaskan.</p>
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
        <!-- Per kelas breakdown -->
        <section class="lg:col-span-3 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-100 px-5 py-4">
            <h2 class="text-base font-semibold text-slate-900">Rekap per Kelas</h2>
            <p class="text-xs text-slate-500 mt-0.5">Distribusi pelanggaran &amp; prestasi tiap kelas</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-100 text-sm">
              <thead class="bg-slate-50">
                <tr>
                  <th class="px-5 py-3 text-left font-semibold text-slate-600">Kelas</th>
                  <th class="px-5 py-3 text-center font-semibold text-slate-600">Santri</th>
                  <th class="px-5 py-3 text-center font-semibold text-slate-600">Pelanggaran</th>
                  <th class="px-5 py-3 text-center font-semibold text-slate-600">Prestasi</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                <tr v-for="k in summary.per_kelas" :key="k.nama" class="hover:bg-slate-50/60">
                  <td class="px-5 py-3 font-medium text-slate-800">{{ k.nama }}</td>
                  <td class="px-5 py-3 text-center text-slate-600">{{ k.jumlah_santri }}</td>
                  <td class="px-5 py-3 text-center">
                    <span class="inline-flex min-w-[2rem] justify-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">{{ k.pelanggaran }}</span>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="inline-flex min-w-[2rem] justify-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{{ k.prestasi }}</span>
                  </td>
                </tr>
                <tr v-if="!summary.per_kelas.length">
                  <td colspan="4" class="px-5 py-8 text-center text-slate-400">Belum ada data kelas.</td>
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
                <p class="truncate text-xs text-slate-500">{{ p.kelas_nama }}</p>
              </div>
              <span class="shrink-0 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">{{ p.total }}</span>
            </li>
            <li v-if="!summary.top_pelanggar.length" class="px-5 py-8 text-center text-sm text-slate-400">
              Tidak ada data pelanggaran.
            </li>
          </ol>
        </section>
      </div>
    </template>
  </div>
</template>

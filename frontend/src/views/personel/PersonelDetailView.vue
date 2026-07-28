<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { personelService } from '@/services'
import EmptyState from '@/components/EmptyState.vue'

interface Kamar { id: string; nama: string; jenis_kelamin: 'L' | 'P' }
interface Kelas { id: string; nama: string; tingkatan: string | null }
interface Aktivitas {
  catatan_disiplin_dicatat: number
  catatan_perkembangan_dicatat: number
  absensi_dicatat: number
  kegiatan_dibuat: number
  pesan_terkirim: number
}
interface Profil {
  id: string
  nama_lengkap: string
  email: string
  role: 'admin' | 'ustadz' | 'kyai' | 'kepala_asrama'
  asrama_jenis?: 'L' | 'P' | null
  status: string
  last_login: string | null
  created_at: string
  assigned_kelas: Kelas[]
  assigned_kamar: Kamar[]
  aktivitas: Aktivitas
}
interface CatatanPersonel {
  id: string
  tanggal: string
  kategori: string
  judul: string
  catatan: string | null
  dicatat_oleh_nama?: string
}
interface SantriRiwayat {
  santri_id: string
  nama_lengkap: string
  santri_status: string
  kamar_nama: string
  mulai_bersama: string
  selesai_bersama: string | null
  masih_diasuh: boolean
}

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const profil = ref<Profil | null>(null)
const catatanList = ref<CatatanPersonel[]>([])
const santriRiwayat = ref<SantriRiwayat[]>([])
const loading = ref(true)
const loadingCatatan = ref(false)
const loadingRiwayat = ref(false)
const error = ref('')
const catatanError = ref('')
const riwayatError = ref('')

const showModal = ref(false)
const saving = ref(false)
const today = new Date().toISOString().slice(0, 10)
const kategoriOptions = ['Kinerja', 'Kehadiran', 'Pelanggaran', 'Prestasi', 'Keputusan Kyai', 'Lainnya']
const form = ref({ tanggal: today, kategori: 'Kinerja', judul: '', catatan: '' })

const kategoriStyle: Record<string, string> = {
  Kinerja: 'bg-emerald-50 text-emerald-700',
  Kehadiran: 'bg-sky-50 text-sky-700',
  Pelanggaran: 'bg-rose-50 text-rose-700',
  Prestasi: 'bg-amber-50 text-amber-700',
  'Keputusan Kyai': 'bg-purple-50 text-purple-700',
  Lainnya: 'bg-slate-100 text-slate-600'
}

const aktivitasTiles = computed(() => {
  if (!profil.value) return []
  const a = profil.value.aktivitas
  return [
    { label: 'Catatan Disiplin', value: a.catatan_disiplin_dicatat },
    { label: 'Catatan Perkembangan', value: a.catatan_perkembangan_dicatat },
    { label: 'Absensi Dicatat', value: a.absensi_dicatat },
    { label: 'Kegiatan Dibuat', value: a.kegiatan_dibuat },
    { label: 'Pesan Terkirim', value: a.pesan_terkirim }
  ]
})

function roleLabel(role: string, asrama?: string | null): string {
  switch (role) {
    case 'admin': return 'Admin'
    case 'kyai': return 'Kyai'
    case 'kepala_asrama': return asrama === 'P' ? 'Kepala Putri' : asrama === 'L' ? 'Kepala Putra' : 'Kepala Asrama'
    default: return 'Ustadz'
  }
}

function formatDateShort(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function loadProfil() {
  loading.value = true
  error.value = ''
  try {
    profil.value = await personelService.get(id)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat profil personel'
  } finally {
    loading.value = false
  }
}

async function loadCatatan() {
  loadingCatatan.value = true
  catatanError.value = ''
  try {
    catatanList.value = await personelService.listCatatan(id)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    catatanError.value = err?.response?.data?.message || 'Gagal memuat catatan personel'
  } finally {
    loadingCatatan.value = false
  }
}

async function loadSantriRiwayat() {
  loadingRiwayat.value = true
  riwayatError.value = ''
  try {
    santriRiwayat.value = await personelService.santriRiwayat(id)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    riwayatError.value = err?.response?.data?.message || 'Gagal memuat riwayat santri yang diasuh'
  } finally {
    loadingRiwayat.value = false
  }
}

function openModal() {
  form.value = { tanggal: today, kategori: 'Kinerja', judul: '', catatan: '' }
  catatanError.value = ''
  showModal.value = true
}

async function submitCatatan() {
  if (!form.value.judul.trim()) {
    catatanError.value = 'Judul wajib diisi'
    return
  }
  saving.value = true
  try {
    await personelService.createCatatan(id, {
      tanggal: form.value.tanggal,
      kategori: form.value.kategori,
      judul: form.value.judul,
      catatan: form.value.catatan || undefined
    })
    showModal.value = false
    await loadCatatan()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    catatanError.value = err?.response?.data?.message || 'Gagal menyimpan catatan'
  } finally {
    saving.value = false
  }
}

async function removeCatatan(catatanId: string) {
  if (!confirm('Hapus catatan ini?')) return
  try {
    await personelService.removeCatatan(catatanId)
    await loadCatatan()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    catatanError.value = err?.response?.data?.message || 'Gagal menghapus catatan'
  }
}

function formatDateTimeShort(d: string | null): string {
  if (!d) return '-'
  return new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

onMounted(() => {
  loadProfil()
  loadCatatan()
  loadSantriRiwayat()
})
</script>

<template>
  <div class="space-y-6">
    <button
      type="button"
      @click="router.push({ name: 'personel' })"
      class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
    >
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
      Kembali ke Profil Personel
    </button>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</div>

    <div v-if="loading" class="h-40 animate-pulse rounded-xl bg-gray-100"></div>

    <template v-else-if="profil">
      <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
            {{ profil.nama_lengkap.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-lg font-semibold text-gray-900">{{ profil.nama_lengkap }}</p>
            <p class="truncate text-sm text-gray-500">{{ profil.email }}</p>
            <div class="mt-1 flex flex-wrap gap-1">
              <span class="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">
                {{ roleLabel(profil.role, profil.asrama_jenis) }}
              </span>
              <span
                :class="[
                  'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                  profil.status === 'approved' ? 'bg-emerald-100 text-emerald-800'
                    : profil.status === 'suspended' ? 'bg-red-100 text-red-800'
                    : 'bg-amber-100 text-amber-800'
                ]"
              >
                {{ profil.status === 'approved' ? 'Aktif' : profil.status === 'suspended' ? 'Ditangguhkan' : 'Menunggu' }}
              </span>
            </div>
          </div>
          <div class="shrink-0 text-right text-xs text-gray-400">
            <p>Login terakhir</p>
            <p class="font-medium text-gray-600">{{ formatDateShort(profil.last_login) }}</p>
          </div>
        </div>

        <div v-if="profil.assigned_kamar.length > 0 || profil.assigned_kelas.length > 0" class="mt-4 flex flex-wrap gap-1.5 border-t border-gray-100 pt-4">
          <span v-for="k in profil.assigned_kamar" :key="'kamar-' + k.id" class="inline-flex rounded-md bg-sky-50 px-2.5 py-1 text-xs text-sky-700">
            {{ k.nama }} · {{ k.jenis_kelamin === 'P' ? 'Putri' : 'Putra' }}
          </span>
          <span v-for="k in profil.assigned_kelas" :key="'kelas-' + k.id" class="inline-flex rounded-md bg-violet-50 px-2.5 py-1 text-xs text-violet-700">
            {{ k.nama }}
          </span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div v-for="tile in aktivitasTiles" :key="tile.label" class="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <p class="text-2xl font-bold text-gray-900">{{ tile.value }}</p>
          <p class="mt-1 text-xs text-gray-500">{{ tile.label }}</p>
        </div>
      </div>

      <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-900">Catatan Personel</h2>
            <p class="mt-0.5 text-xs text-slate-500">Evaluasi kinerja, pendapat/keputusan kyai, dan catatan lainnya</p>
          </div>
          <button
            @click="openModal"
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Tambah Catatan
          </button>
        </div>

        <div class="p-5">
          <div v-if="catatanError" class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ catatanError }}</div>

          <div v-if="loadingCatatan" class="space-y-2">
            <div v-for="i in 3" :key="i" class="h-16 animate-pulse rounded-lg bg-slate-100"></div>
          </div>

          <ol v-else-if="catatanList.length" class="relative space-y-6 border-l-2 border-slate-100 pl-6">
            <li v-for="c in catatanList" :key="c.id" class="relative">
              <span class="absolute -left-[1.95rem] flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-4 ring-white shadow-xs">
                <svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>

              <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-slate-300">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset"
                    :class="kategoriStyle[c.kategori] || 'bg-slate-100 text-slate-600'"
                  >{{ c.kategori }}</span>
                  <div class="flex items-center gap-2">
                    <time class="text-xs font-medium text-slate-400">{{ formatDateShort(c.tanggal) }}</time>
                    <button
                      @click="removeCatatan(c.id)"
                      title="Hapus catatan"
                      class="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <h3 class="mt-2.5 text-sm font-bold text-slate-800">{{ c.judul }}</h3>
                <p v-if="c.catatan" class="mt-1 text-sm leading-relaxed text-slate-500">{{ c.catatan }}</p>
                <p v-if="c.dicatat_oleh_nama" class="mt-2 text-xs italic text-slate-400">— {{ c.dicatat_oleh_nama }}</p>
              </div>
            </li>
          </ol>

          <EmptyState
            v-else
            title="Belum ada catatan personel"
            description="Catatan kinerja, kehadiran, atau keputusan kyai akan muncul di sini."
          />
        </div>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="border-b border-slate-100 px-5 py-4">
          <h2 class="text-base font-semibold text-slate-900">Santri yang Pernah Diasuh</h2>
          <p class="mt-0.5 text-xs text-slate-500">Berdasarkan riwayat penempatan kamar — mulai tercatat sejak fitur ini dirilis</p>
        </div>

        <div class="p-5">
          <div v-if="riwayatError" class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ riwayatError }}</div>

          <div v-if="loadingRiwayat" class="space-y-2">
            <div v-for="i in 3" :key="i" class="h-12 animate-pulse rounded-lg bg-slate-100"></div>
          </div>

          <div v-else-if="santriRiwayat.length" class="divide-y divide-slate-100">
            <div v-for="r in santriRiwayat" :key="r.santri_id + r.mulai_bersama" class="flex flex-wrap items-center justify-between gap-2 py-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-slate-800">{{ r.nama_lengkap }}</p>
                <p class="text-xs text-slate-400">{{ r.kamar_nama }} · {{ formatDateTimeShort(r.mulai_bersama) }} – {{ r.selesai_bersama ? formatDateTimeShort(r.selesai_bersama) : 'sekarang' }}</p>
              </div>
              <span
                v-if="r.masih_diasuh"
                class="inline-flex shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
              >Masih diasuh</span>
              <span v-else class="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Riwayat</span>
            </div>
          </div>

          <EmptyState
            v-else
            title="Belum ada riwayat"
            description="Santri yang pernah/masih diasuh lewat penempatan kamar akan muncul di sini."
          />
        </div>
      </section>
    </template>

    <div
      v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="showModal = false"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Tambah Catatan Personel</h2>
        <div v-if="catatanError" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ catatanError }}</div>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Tanggal</label>
            <input v-model="form.tanggal" type="date" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Kategori</label>
            <select v-model="form.kategori" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option v-for="opt in kategoriOptions" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Judul</label>
            <input v-model="form.judul" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Catatan (opsional)</label>
            <textarea v-model="form.catatan" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"></textarea>
          </div>
        </div>
        <div class="mt-6 flex gap-3">
          <button
            type="button"
            :disabled="saving"
            @click="submitCatatan"
            class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {{ saving ? 'Menyimpan...' : 'Simpan' }}
          </button>
          <button
            type="button"
            @click="showModal = false"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

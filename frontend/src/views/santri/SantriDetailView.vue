<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { perizinanService } from '@/services'
import { useAuthStore } from '@/stores/auth'
import { useEntityDetail } from '@/offline/composables/useEntityDetail'
import { useEntityList } from '@/offline/composables/useEntityList'
import { useEntityMutation } from '@/offline/composables/useEntityMutation'
import EmptyState from '@/components/EmptyState.vue'

const auth = useAuthStore()

interface Kategori {
  id: string
  nama: string
  urutan_keparahan?: number
}

interface Kelas {
  id: string
  nama: string
}

interface Kamar {
  id: string
  nama: string
  jenis_kelamin: 'L' | 'P'
}

interface Catatan {
  id: string
  santri_id: string
  tipe: 'pelanggaran' | 'prestasi'
  judul: string
  deskripsi?: string | null
  tanggal_kejadian: string
  kategori_id?: string | null
  jenis_prestasi?: string | null
  is_deleted?: number
}

interface SantriCache {
  id: string
  nama_lengkap: string
  jenis_kelamin: 'L' | 'P'
  kelas_id: string | null
  kamar_id: string | null
  angkatan?: string | number | null
  status: string
  tanggal_masuk?: string | null
  tanggal_lahir?: string | null
  love_language?: string | null
}

interface CatatanHaid {
  id: string
  santri_id: string
  tanggal: string
  status: 'suci' | 'haid'
  catatan?: string | null
  is_deleted?: number
}

interface CatatanPerkembangan {
  id: string
  santri_id: string
  tanggal: string
  kategori: string
  judul: string
  catatan?: string | null
  is_deleted?: number
}

type TabKey = 'disiplin' | 'perkembangan' | 'haid'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)

// Profil santri sekarang dari cache Dexie (reaktif, liveQuery) — bukan
// santriService.get() langsung lagi. useEntityList lain di bawah (kelas/
// kamar/kategori/catatan_*) sudah men-trigger pullAll() bersama, jadi entity
// santri ikut kepull tanpa perlu panggilan terpisah (mirror SantriFormView).
const { item: santri, loading } = useEntityDetail<SantriCache>('santri', id)
const notFound = computed(() => !loading.value && !santri.value)

const { allItems: kelasList } = useEntityList<Kelas>('kelas')
const { allItems: kamarList } = useEntityList<Kamar>('kamar')
const { allItems: kategoriList } = useEntityList<Kategori>('kategori_pelanggaran')
const kelasNameById = computed(() => new Map(kelasList.value.map((k) => [k.id, k.nama])))
const kamarNameById = computed(() => new Map(kamarList.value.map((k) => [k.id, k.nama])))
const kategoriNameById = computed(() => new Map(kategoriList.value.map((k) => [k.id, k.nama])))

const error = ref('')

const showCatatanModal = ref(false)
const savingCatatan = ref(false)
const catatanError = ref('')

const today = new Date().toISOString().slice(0, 10)
const catatanForm = ref({
  tipe: 'pelanggaran' as 'pelanggaran' | 'prestasi',
  kategori_id: '',
  jenis_prestasi: '',
  judul: '',
  deskripsi: '',
  tanggal: today,
})

const activeTab = ref<TabKey>('disiplin')

// ---- Catatan Disiplin (push-eligible sejak gelombang 2) ----
const catatanMutation = useEntityMutation<Catatan>('catatan_disiplin')
const { allItems: catatanAll } = useEntityList<Catatan>('catatan_disiplin')
const sortedCatatan = computed(() =>
  catatanAll.value
    .filter((c) => c.santri_id === id && !c.is_deleted)
    .sort((a, b) => (b.tanggal_kejadian || '').localeCompare(a.tanggal_kejadian || ''))
)

const jumlahPelanggaran = computed(() => sortedCatatan.value.filter((c) => c.tipe === 'pelanggaran').length)
const jumlahPrestasi = computed(() => sortedCatatan.value.filter((c) => c.tipe === 'prestasi').length)

const pelanggaranByKategori = computed(() => {
  const map = new Map<string, number>()
  for (const c of sortedCatatan.value) {
    if (c.tipe === 'pelanggaran') {
      const key = (c.kategori_id ? kategoriNameById.value.get(c.kategori_id) : undefined) ?? 'Lainnya'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
  }
  const total = jumlahPelanggaran.value || 1
  return Array.from(map.entries())
    .map(([nama, jumlah]) => ({ nama, jumlah, persen: Math.round((jumlah / total) * 100) }))
    .sort((a, b) => b.jumlah - a.jumlah)
    .slice(0, 5)
})

const maxKategoriJumlah = computed(() =>
  pelanggaranByKategori.value.reduce((max, k) => Math.max(max, k.jumlah), 0) || 1
)

// ---- Catatan Suci/Haid (push-eligible bundel ini) ----
const haidMutation = useEntityMutation<CatatanHaid>('catatan_haid')
const { allItems: haidAll } = useEntityList<CatatanHaid>('catatan_haid')
const sortedCatatanHaid = computed(() =>
  haidAll.value
    .filter((h) => h.santri_id === id && !h.is_deleted)
    .sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''))
)
const haidError = ref('')
const savingHaid = ref(false)
const haidForm = ref({ tanggal: today, status: 'suci' as 'suci' | 'haid', catatan: '' })

// Gerbang TAMPILAN doang (mirror haidAccessCheck backend) — penegakan
// sungguhan tetap 100% di server (pull cuma balikin baris yang boleh dia
// lihat, push ditolak scope kalau gak berhak). admin global; KYAI SENGAJA
// diblokir total (data sensitif, beda dari catatan_disiplin/perkembangan);
// kepala_asrama cuma asrama putri; ustadz cuma kalau kamar santri ini
// muncul di cache kamar DIA SENDIRI (pull kamar sudah dibatasi server ke
// kamar yang dia pegang, lihat resolveKamarScope) dan kamarnya jenis putri.
const haidAccessible = computed(() => {
  if (!santri.value || santri.value.jenis_kelamin !== 'P') return false
  if (auth.user?.role === 'admin') return true
  if (auth.user?.role === 'kyai') return false
  if (auth.user?.role === 'kepala_asrama') return auth.user?.asrama_jenis === 'P'
  return kamarList.value.some((k) => k.id === santri.value?.kamar_id && k.jenis_kelamin === 'P')
})

// ---- Catatan Perkembangan (push-eligible bundel ini) ----
const perkembanganMutation = useEntityMutation<CatatanPerkembangan>('catatan_perkembangan')
const { allItems: perkembanganAll } = useEntityList<CatatanPerkembangan>('catatan_perkembangan')
const sortedPerkembangan = computed(() =>
  perkembanganAll.value
    .filter((c) => c.santri_id === id && !c.is_deleted)
    .sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''))
)
const perkembanganError = ref('')
const showPerkembanganModal = ref(false)
const savingPerkembangan = ref(false)
const kategoriPerkembanganOptions = ['Perkembangan', 'Kesehatan', 'Keluarga', 'Sosial', 'Akademik', 'Spiritual']
const perkembanganForm = ref({ tanggal: today, kategori: 'Perkembangan', judul: '', catatan: '' })

const statusLabels: Record<string, string> = {
  aktif: 'Aktif',
  lulus: 'Lulus',
  nonaktif: 'Nonaktif',
}
const statusBadge: Record<string, string> = {
  aktif: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  lulus: 'bg-sky-50 text-sky-700 ring-sky-200',
  nonaktif: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const kategoriPerkembanganStyle: Record<string, string> = {
  Perkembangan: 'bg-emerald-50 text-emerald-700',
  Kesehatan: 'bg-rose-50 text-rose-700',
  Keluarga: 'bg-violet-50 text-violet-700',
  Sosial: 'bg-sky-50 text-sky-700',
  Akademik: 'bg-amber-50 text-amber-700',
  Spiritual: 'bg-indigo-50 text-indigo-700',
}

function kelaminLabel(k: string) {
  return k === 'L' ? 'Laki-laki' : k === 'P' ? 'Perempuan' : '-'
}

function formatDate(d?: string | null) {
  if (!d) return '-'
  try {
    return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d))
  } catch {
    return d
  }
}

function formatDateShort(d?: string | null) {
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d))
  } catch {
    return d
  }
}

function openCatatanModal() {
  catatanForm.value = {
    tipe: 'pelanggaran',
    kategori_id: '',
    jenis_prestasi: '',
    judul: '',
    deskripsi: '',
    tanggal: today,
  }
  catatanError.value = ''
  showCatatanModal.value = true
}

async function submitCatatan() {
  catatanError.value = ''
  if (!catatanForm.value.judul.trim()) {
    catatanError.value = 'Judul wajib diisi.'
    return
  }
  if (catatanForm.value.tipe === 'pelanggaran' && !catatanForm.value.kategori_id) {
    catatanError.value = 'Kategori pelanggaran wajib dipilih.'
    return
  }
  if (!catatanForm.value.tanggal) {
    catatanError.value = 'Tanggal wajib diisi.'
    return
  }

  savingCatatan.value = true
  try {
    const payload: Record<string, unknown> = {
      santri_id: id,
      tipe: catatanForm.value.tipe,
      judul: catatanForm.value.judul.trim(),
      deskripsi: catatanForm.value.deskripsi.trim(),
      tanggal_kejadian: catatanForm.value.tanggal,
    }
    if (catatanForm.value.tipe === 'pelanggaran' && catatanForm.value.kategori_id) {
      payload.kategori_id = catatanForm.value.kategori_id
    }
    if (catatanForm.value.tipe === 'prestasi' && catatanForm.value.jenis_prestasi.trim()) {
      payload.jenis_prestasi = catatanForm.value.jenis_prestasi.trim()
    }
    await catatanMutation.create(payload)
    showCatatanModal.value = false
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    catatanError.value = err?.response?.data?.message || 'Gagal menambah catatan.'
  } finally {
    savingCatatan.value = false
  }
}

async function removeCatatan(catatanId: string) {
  if (!confirm('Hapus catatan ini?')) return
  try {
    await catatanMutation.remove(catatanId)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menghapus catatan.'
  }
}

async function submitHaid() {
  haidError.value = ''
  if (!haidForm.value.tanggal) {
    haidError.value = 'Tanggal wajib diisi.'
    return
  }
  savingHaid.value = true
  try {
    // Cek cache lokal dulu (bukan langsung create) — mirror semantik upsert
    // backend (ON CONFLICT santri_id+tanggal). Ini juga yang mencegah
    // skenario paling mungkin utk tabrakan natural-key: user yang sama
    // ngedit entri hari yang sama dua kali sebelum sempat sync (lihat
        // catatan di push.ts applyResults soal sisa kasus lintas-device yang
    // jauh lebih jarang).
    const existing = sortedCatatanHaid.value.find((h) => h.tanggal === haidForm.value.tanggal)
    const patch = { status: haidForm.value.status, catatan: haidForm.value.catatan.trim() || undefined }
    if (existing) {
      await haidMutation.update(existing.id, patch)
    } else {
      await haidMutation.create({ santri_id: id, tanggal: haidForm.value.tanggal, ...patch })
    }
    haidForm.value.catatan = ''
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    haidError.value = err?.response?.data?.message || 'Gagal menyimpan catatan haid.'
  } finally {
    savingHaid.value = false
  }
}

async function removeHaid(haidId: string) {
  if (!confirm('Hapus catatan ini?')) return
  try {
    await haidMutation.remove(haidId)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    haidError.value = err?.response?.data?.message || 'Gagal menghapus catatan haid.'
  }
}

function openPerkembanganModal() {
  perkembanganForm.value = { tanggal: today, kategori: 'Perkembangan', judul: '', catatan: '' }
  perkembanganError.value = ''
  showPerkembanganModal.value = true
}

async function submitPerkembangan() {
  perkembanganError.value = ''
  if (!perkembanganForm.value.judul.trim()) {
    perkembanganError.value = 'Judul wajib diisi.'
    return
  }
  savingPerkembangan.value = true
  try {
    await perkembanganMutation.create({
      santri_id: id,
      tanggal: perkembanganForm.value.tanggal,
      kategori: perkembanganForm.value.kategori,
      judul: perkembanganForm.value.judul.trim(),
      catatan: perkembanganForm.value.catatan.trim() || undefined,
    })
    showPerkembanganModal.value = false
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    perkembanganError.value = err?.response?.data?.message || 'Gagal menambah catatan perkembangan.'
  } finally {
    savingPerkembangan.value = false
  }
}

async function removePerkembangan(catatanId: string) {
  if (!confirm('Hapus catatan ini?')) return
  try {
    await perkembanganMutation.remove(catatanId)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    perkembanganError.value = err?.response?.data?.message || 'Gagal menghapus catatan.'
  }
}

// Izin pulang TETAP network langsung — belum masuk migrasi (gelombang 3,
// termasuk transisi approve/tolak/kembali, sengaja ditunda ke akhir).
interface Perizinan {
  id: string
  tanggal_keluar: string
  perkiraan_kembali: string | null
  alasan: string
}
const izinAktif = ref<Perizinan | null>(null)
const loadingIzin = ref(false)
const izinError = ref('')
const markingKembali = ref(false)

async function loadIzinAktif() {
  loadingIzin.value = true
  izinError.value = ''
  try {
    const rows = (await perizinanService.list({ santri_id: id, status: 'disetujui' })) as Perizinan[]
    izinAktif.value = rows[0] ?? null
  } catch {
    izinAktif.value = null
  } finally {
    loadingIzin.value = false
  }
}

async function markKembali() {
  if (!izinAktif.value) return
  markingKembali.value = true
  izinError.value = ''
  try {
    await perizinanService.kembali(izinAktif.value.id)
    izinAktif.value = null
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    izinError.value = err?.response?.data?.message || 'Gagal menandai kembali.'
  } finally {
    markingKembali.value = false
  }
}

onMounted(() => {
  loadIzinAktif()
})
</script>

<template>
  <div class="space-y-5">
    <!-- Back -->
    <button
      @click="router.back()"
      class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-emerald-700"
    >
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      Kembali
    </button>

    <!-- Error -->
    <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ error }}</div>

    <!-- Belum ada di cache lokal (mis. belum pernah ke-pull, atau id salah) -->
    <div v-if="notFound" class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      Data santri ini belum tersedia di cache lokal. Coba sinkronkan dulu selagi online, atau periksa kembali tautannya.
    </div>

    <!-- Banner: sedang izin pulang -->
    <div v-if="izinAktif" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div class="flex items-start gap-3">
        <svg class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3v10.5a3 3 0 01-3 3h-7.5a3 3 0 01-3-3V15m9-9.75v2.25M8.25 5.25v2.25M12 13.5h6.75m-6.75 3h6.75M12 13.5h.008v.008H12V13.5z" />
        </svg>
        <div>
          <p class="text-sm font-semibold text-amber-800">Sedang izin pulang</p>
          <p class="text-xs text-amber-700">
            {{ izinAktif.alasan }} — keluar sejak {{ formatDateShort(izinAktif.tanggal_keluar) }}
            <span v-if="izinAktif.perkiraan_kembali"> · perkiraan kembali {{ formatDateShort(izinAktif.perkiraan_kembali) }}</span>
          </p>
          <p v-if="izinError" class="mt-1 text-xs text-rose-600">{{ izinError }}</p>
        </div>
      </div>
      <button
        v-if="!auth.isReadOnly"
        type="button"
        :disabled="markingKembali"
        @click="markKembali"
        class="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
      >
        {{ markingKembali ? 'Memproses...' : 'Tandai Kembali' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="animate-pulse space-y-4">
      <div class="h-40 rounded-xl bg-slate-200"></div>
      <div class="h-64 rounded-xl bg-slate-100"></div>
    </div>

    <template v-else-if="santri">
      <!-- Profile card -->
      <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="h-20 bg-gradient-to-r from-emerald-500 to-green-600"></div>
        <div class="px-5 pb-5">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div class="flex items-end gap-4">
              <div class="-mt-12 flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border-4 border-white bg-emerald-100 text-3xl font-bold text-emerald-700 shadow-sm">
                {{ santri.nama_lengkap.charAt(0).toUpperCase() }}
              </div>
              <div class="pb-1">
                <h1 class="text-xl font-bold text-slate-900">{{ santri.nama_lengkap }}</h1>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset"
                    :class="statusBadge[santri.status] || statusBadge.nonaktif"
                  >{{ statusLabels[santri.status] || santri.status }}</span>
                  <span class="text-sm text-slate-500">{{ kelaminLabel(santri.jenis_kelamin) }}</span>
                </div>
              </div>
            </div>
            <button
              v-if="!auth.isReadOnly"
              @click="router.push({ name: 'santri-edit', params: { id: santri.id } })"
              class="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
          </div>

          <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-400">Kelas</dt>
              <dd class="mt-1 text-sm font-medium text-slate-800">{{ santri.kelas_id ? (kelasNameById.get(santri.kelas_id) ?? '-') : '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-400">Kamar</dt>
              <dd class="mt-1 text-sm font-medium text-slate-800">{{ santri.kamar_id ? (kamarNameById.get(santri.kamar_id) ?? '-') : '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-400">Angkatan</dt>
              <dd class="mt-1 text-sm font-medium text-slate-800">{{ santri.angkatan ?? '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-400">Tanggal Masuk</dt>
              <dd class="mt-1 text-sm font-medium text-slate-800">{{ formatDate(santri.tanggal_masuk) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-400">Tanggal Lahir</dt>
              <dd class="mt-1 text-sm font-medium text-slate-800">{{ santri.tanggal_lahir ? formatDate(santri.tanggal_lahir) : '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-400">Love Language</dt>
              <dd class="mt-1 text-sm font-medium text-slate-800">{{ santri.love_language || '-' }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-400">Status</dt>
              <dd class="mt-1 text-sm font-medium text-slate-800">{{ statusLabels[santri.status] || santri.status }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- Tabs -->
      <div class="flex gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        <button
          @click="activeTab = 'disiplin'"
          class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition"
          :class="activeTab === 'disiplin' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'"
        >Disiplin</button>
        <button
          @click="activeTab = 'perkembangan'"
          class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition"
          :class="activeTab === 'perkembangan' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'"
        >Perkembangan</button>
        <button
          v-if="santri.jenis_kelamin === 'P' && haidAccessible"
          @click="activeTab = 'haid'"
          class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition"
          :class="activeTab === 'haid' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'"
        >Suci/Haid</button>
      </div>

      <!-- Tab: Disiplin -->
      <section v-if="activeTab === 'disiplin'" class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-900">Catatan Disiplin</h2>
            <p class="text-xs text-slate-500 mt-0.5">Riwayat pelanggaran &amp; prestasi santri</p>
          </div>
          <button
            v-if="!auth.isReadOnly"
            @click="openCatatanModal"
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Tambah Catatan
          </button>
        </div>

        <!-- Stat row / summary bar -->
        <div class="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-b border-slate-100">
          <div class="px-5 py-4 text-center md:text-left md:py-6">
            <p class="text-3xl font-bold text-rose-600">{{ jumlahPelanggaran }}</p>
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-1">Pelanggaran Terdaftar</p>
          </div>
          <div class="px-5 py-4 text-center md:text-left md:py-6">
            <p class="text-3xl font-bold text-amber-600">{{ jumlahPrestasi }}</p>
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-1">Prestasi Terdaftar</p>
          </div>
          <div class="px-5 py-4 md:py-6">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 text-center md:text-left mb-2">Distribusi Pelanggaran</p>
            <div v-if="pelanggaranByKategori.length" class="space-y-1.5">
              <div v-for="kat in pelanggaranByKategori" :key="kat.nama" class="flex items-center gap-2">
                <span class="text-xs font-medium text-slate-600 w-24 truncate" :title="kat.nama">{{ kat.nama }}</span>
                <div class="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                  <div class="h-full bg-rose-500 rounded" :style="{ width: (kat.jumlah / maxKategoriJumlah * 100) + '%' }"></div>
                </div>
                <span class="text-xs font-bold text-slate-500 w-6 text-right">{{ kat.jumlah }}×</span>
              </div>
            </div>
            <p v-else class="text-xs text-slate-400 italic text-center md:text-left py-2">Belum ada pelanggaran</p>
          </div>
        </div>

        <!-- Timeline -->
        <div class="p-5">
          <ol v-if="sortedCatatan.length" class="relative space-y-6 border-l-2 border-slate-100 pl-6">
            <li v-for="c in sortedCatatan" :key="c.id" class="relative">
              <span
                class="absolute -left-[1.95rem] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white shadow-xs"
                :class="c.tipe === 'pelanggaran' ? 'bg-rose-500' : 'bg-amber-500'"
              >
                <svg v-if="c.tipe === 'pelanggaran'" class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01" />
                </svg>
                <svg v-else class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l2.95 6.36L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.05-.91L12 2z" />
                </svg>
              </span>

              <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition-colors">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset"
                      :class="c.tipe === 'pelanggaran' ? 'bg-rose-50 text-rose-700 ring-rose-600/10' : 'bg-amber-50 text-amber-700 ring-amber-600/10'"
                    >{{ c.tipe === 'pelanggaran' ? 'Pelanggaran' : 'Prestasi' }}</span>
                    <span
                      v-if="c.kategori_id && kategoriNameById.get(c.kategori_id)"
                      class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                    >{{ kategoriNameById.get(c.kategori_id) }}</span>
                    <span
                      v-if="c.jenis_prestasi"
                      class="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/10"
                    >{{ c.jenis_prestasi }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <time class="text-xs text-slate-400 font-medium">{{ formatDate(c.tanggal_kejadian) }}</time>
                    <button
                      v-if="!auth.isReadOnly"
                      @click="removeCatatan(c.id)"
                      title="Hapus catatan"
                      class="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                    >
                      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <h3 class="mt-2.5 text-sm font-bold text-slate-800">{{ c.judul }}</h3>
                <p v-if="c.deskripsi" class="mt-1 text-sm text-slate-500 leading-relaxed">{{ c.deskripsi }}</p>
              </div>
            </li>
          </ol>

          <EmptyState
            v-else
            title="Belum ada catatan disiplin"
            description="Pelanggaran atau prestasi yang dicatat akan muncul di sini."
          />
        </div>
      </section>

      <!-- Tab: Perkembangan -->
      <section v-if="activeTab === 'perkembangan'" class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-900">Catatan Perkembangan</h2>
            <p class="text-xs text-slate-500 mt-0.5">Perkembangan, kesehatan, kejadian khusus, dll</p>
          </div>
          <button
            v-if="!auth.isReadOnly"
            @click="openPerkembanganModal"
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Tambah Catatan
          </button>
        </div>

        <div class="p-5">
          <div v-if="perkembanganError" class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ perkembanganError }}</div>

          <ol v-if="sortedPerkembangan.length" class="relative space-y-6 border-l-2 border-slate-100 pl-6">
            <li v-for="c in sortedPerkembangan" :key="c.id" class="relative">
              <span class="absolute -left-[1.95rem] flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 ring-4 ring-white shadow-xs">
                <svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>

              <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition-colors">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset"
                      :class="kategoriPerkembanganStyle[c.kategori] || 'bg-slate-100 text-slate-600'"
                    >{{ c.kategori }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <time class="text-xs text-slate-400 font-medium">{{ formatDateShort(c.tanggal) }}</time>
                    <button
                      v-if="!auth.isReadOnly"
                      @click="removePerkembangan(c.id)"
                      title="Hapus catatan"
                      class="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                    >
                      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <h3 class="mt-2.5 text-sm font-bold text-slate-800">{{ c.judul }}</h3>
                <p v-if="c.catatan" class="mt-1 text-sm text-slate-500 leading-relaxed">{{ c.catatan }}</p>
              </div>
            </li>
          </ol>

          <EmptyState
            v-else
            title="Belum ada catatan perkembangan"
            description="Catatan perkembangan santri akan muncul di sini."
          />
        </div>
      </section>

      <!-- Tab: Haid -->
      <section v-if="activeTab === 'haid' && santri.jenis_kelamin === 'P' && haidAccessible" class="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="border-b border-slate-100 px-5 py-4">
          <h2 class="text-base font-semibold text-slate-900">Catatan Suci/Haid</h2>
          <p class="text-xs text-slate-500 mt-0.5">Hanya terlihat oleh admin dan wali kamar putri terkait</p>
        </div>

        <div class="p-5 space-y-4">
          <div v-if="haidError" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ haidError }}</div>

          <form v-if="!auth.isReadOnly" @submit.prevent="submitHaid" class="flex flex-wrap items-end gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-600">Tanggal</label>
              <input
                v-model="haidForm.tanggal"
                type="date"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-600">Status</label>
              <div class="flex gap-2">
                <label
                  class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition"
                  :class="haidForm.status === 'suci' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'"
                >
                  <input v-model="haidForm.status" type="radio" value="suci" class="sr-only" />
                  Suci
                </label>
                <label
                  class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition"
                  :class="haidForm.status === 'haid' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'"
                >
                  <input v-model="haidForm.status" type="radio" value="haid" class="sr-only" />
                  Haid
                </label>
              </div>
            </div>
            <div class="min-w-[10rem] flex-1">
              <label class="mb-1 block text-xs font-medium text-slate-600">Catatan (opsional)</label>
              <input
                v-model="haidForm.catatan"
                type="text"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <button
              type="submit"
              :disabled="savingHaid"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >{{ savingHaid ? 'Menyimpan...' : 'Simpan' }}</button>
          </form>

          <ul v-if="sortedCatatanHaid.length" class="divide-y divide-slate-100 rounded-lg border border-slate-200">
            <li v-for="hRow in sortedCatatanHaid" :key="hRow.id" class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="flex items-center gap-3">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                  :class="hRow.status === 'haid' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'"
                >{{ hRow.status === 'haid' ? 'Haid' : 'Suci' }}</span>
                <time class="text-sm text-slate-600">{{ formatDateShort(hRow.tanggal) }}</time>
                <span v-if="hRow.catatan" class="text-xs text-slate-400">{{ hRow.catatan }}</span>
              </div>
              <button
                @click="removeHaid(hRow.id)"
                title="Hapus"
                class="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          </ul>
          <p v-else class="text-sm text-slate-400">Belum ada catatan.</p>
        </div>
      </section>
    </template>

    <!-- Tambah Catatan Modal -->
    <Teleport to="body">
      <div v-if="showCatatanModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/50" @click="!savingCatatan && (showCatatanModal = false)"></div>
        <div class="relative w-full max-w-lg rounded-xl bg-white shadow-xl">
          <div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 class="text-base font-semibold text-slate-900">Tambah Catatan Disiplin</h3>
            <button
              @click="showCatatanModal = false"
              :disabled="savingCatatan"
              class="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form @submit.prevent="submitCatatan" class="space-y-4 px-5 py-4">
            <!-- Tipe -->
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Tipe</label>
              <div class="grid grid-cols-2 gap-3">
                <label
                  class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition"
                  :class="catatanForm.tipe === 'pelanggaran' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'"
                >
                  <input v-model="catatanForm.tipe" type="radio" value="pelanggaran" class="sr-only" />
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                  </svg>
                  Pelanggaran
                </label>
                <label
                  class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition"
                  :class="catatanForm.tipe === 'prestasi' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'"
                >
                  <input v-model="catatanForm.tipe" type="radio" value="prestasi" class="sr-only" />
                  <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l2.95 6.36L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.05-.91L12 2z" />
                  </svg>
                  Prestasi
                </label>
              </div>
            </div>

            <!-- Kategori (pelanggaran only) -->
            <div v-if="catatanForm.tipe === 'pelanggaran'">
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Kategori <span class="text-rose-500">*</span></label>
              <select
                v-model="catatanForm.kategori_id"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
              >
                <option value="">Pilih kategori...</option>
                <option v-for="k in kategoriList" :key="k.id" :value="k.id">{{ k.nama }}</option>
              </select>
            </div>

            <!-- Jenis Prestasi (prestasi only) -->
            <div v-if="catatanForm.tipe === 'prestasi'">
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Jenis Prestasi</label>
              <input
                v-model="catatanForm.jenis_prestasi"
                type="text"
                placeholder="Bebas, mis. Hafalan Juz 30..."
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <!-- Judul -->
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Judul <span class="text-rose-500">*</span></label>
              <input
                v-model="catatanForm.judul"
                type="text"
                placeholder="Mis. Terlambat sholat subuh"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <!-- Deskripsi -->
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Deskripsi</label>
              <textarea
                v-model="catatanForm.deskripsi"
                rows="3"
                placeholder="Keterangan tambahan..."
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              ></textarea>
            </div>

            <!-- Tanggal -->
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Tanggal <span class="text-rose-500">*</span></label>
              <input
                v-model="catatanForm.tanggal"
                type="date"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div v-if="catatanError" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ catatanError }}</div>

            <div class="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                @click="showCatatanModal = false"
                :disabled="savingCatatan"
                class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >Batal</button>
              <button
                type="submit"
                :disabled="savingCatatan"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {{ savingCatatan ? 'Menyimpan...' : 'Simpan Catatan' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Tambah Catatan Perkembangan Modal -->
    <Teleport to="body">
      <div v-if="showPerkembanganModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/50" @click="!savingPerkembangan && (showPerkembanganModal = false)"></div>
        <div class="relative w-full max-w-lg rounded-xl bg-white shadow-xl">
          <div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 class="text-base font-semibold text-slate-900">Tambah Catatan Perkembangan</h3>
            <button
              @click="showPerkembanganModal = false"
              :disabled="savingPerkembangan"
              class="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form @submit.prevent="submitPerkembangan" class="space-y-4 px-5 py-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Kategori <span class="text-rose-500">*</span></label>
              <select
                v-model="perkembanganForm.kategori"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
              >
                <option v-for="k in kategoriPerkembanganOptions" :key="k" :value="k">{{ k }}</option>
              </select>
            </div>

            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Judul <span class="text-rose-500">*</span></label>
              <input
                v-model="perkembanganForm.judul"
                type="text"
                placeholder="Mis. Mulai rutin hafalan baru"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Catatan</label>
              <textarea
                v-model="perkembanganForm.catatan"
                rows="3"
                placeholder="Keterangan tambahan..."
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              ></textarea>
            </div>

            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-700">Tanggal <span class="text-rose-500">*</span></label>
              <input
                v-model="perkembanganForm.tanggal"
                type="date"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div v-if="perkembanganError" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ perkembanganError }}</div>

            <div class="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                @click="showPerkembanganModal = false"
                :disabled="savingPerkembangan"
                class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >Batal</button>
              <button
                type="submit"
                :disabled="savingPerkembangan"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {{ savingPerkembangan ? 'Menyimpan...' : 'Simpan Catatan' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { pesanService } from '@/services'

const auth = useAuthStore()
const route = useRoute()

const canCompose = computed(() => auth.isKyai || auth.isAdmin)

type Tab = 'inbox' | 'sent'
const activeTab = ref<Tab>(canCompose.value && route.name === 'pesan-compose' ? 'sent' : 'inbox')

interface PesanRow {
  id: string
  judul: string
  isi: string
  prioritas: 'biasa' | 'penting'
  penerima_id: string | null
  asrama_jenis: 'L' | 'P' | null
  pengirim_nama?: string
  sudah_dibaca?: number
  created_at: string
}

const inbox = ref<PesanRow[]>([])
const sent = ref<PesanRow[]>([])
const loading = ref(false)
const error = ref('')

// Compose form
const showCompose = ref(false)
const composeForm = ref({
  judul: '',
  isi: '',
  prioritas: 'biasa' as 'biasa' | 'penting',
  targetMode: 'all' as 'all' | 'asrama' | 'specific',
  asrama_jenis: 'L' as 'L' | 'P',
  penerima_id: ''
})
const recipients = ref<Array<{ id: string; nama_lengkap: string; asrama: string | null }>>([])
const sending = ref(false)
const composeError = ref('')
const composeSuccess = ref('')

// Detail view
const selectedPesan = ref<PesanRow | null>(null)
const loadingDetail = ref(false)
const composeTimer = ref<ReturnType<typeof setTimeout> | null>(null)

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function targetLabel(p: PesanRow): string {
  if (p.penerima_id) return 'Langsung'
  if (p.asrama_jenis === 'L') return 'Asrama Putra'
  if (p.asrama_jenis === 'P') return 'Asrama Putri'
  return 'Semua Ustadz'
}

async function loadInbox() {
  try {
    const res = await pesanService.inbox()
    inbox.value = res.data || []
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat pesan masuk.'
  }
}

async function loadSent() {
  try {
    const res = await pesanService.sent()
    sent.value = res.data || []
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat pesan terkirim.'
  }
}

async function loadData() {
  loading.value = true
  error.value = ''
  if (activeTab.value === 'inbox') await loadInbox()
  else await loadSent()
  loading.value = false
}

async function loadRecipients() {
  try {
    recipients.value = await pesanService.recipients()
  } catch {
    recipients.value = []
  }
}

function openCompose() {
  showCompose.value = true
  composeError.value = ''
  composeSuccess.value = ''
  if (recipients.value.length === 0) loadRecipients()
}

async function sendPesan() {
  composeError.value = ''
  composeSuccess.value = ''
  if (!composeForm.value.judul.trim() || !composeForm.value.isi.trim()) {
    composeError.value = 'Judul dan isi wajib diisi.'
    return
  }
  sending.value = true
  try {
    const payload: { judul: string; isi: string; prioritas?: 'biasa' | 'penting'; penerima_id?: string; asrama_jenis?: 'L' | 'P' } = {
      judul: composeForm.value.judul,
      isi: composeForm.value.isi,
      prioritas: composeForm.value.prioritas
    }
    if (composeForm.value.targetMode === 'asrama') payload.asrama_jenis = composeForm.value.asrama_jenis
    if (composeForm.value.targetMode === 'specific' && composeForm.value.penerima_id) payload.penerima_id = composeForm.value.penerima_id

    await pesanService.send(payload)
    composeSuccess.value = 'Pesan berhasil dikirim.'
    composeForm.value = { judul: '', isi: '', prioritas: 'biasa', targetMode: 'all', asrama_jenis: 'L', penerima_id: '' }
    if (activeTab.value === 'sent') loadSent()
    composeTimer.value = setTimeout(() => { showCompose.value = false; composeSuccess.value = '' }, 1500)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    composeError.value = err?.response?.data?.message || 'Gagal mengirim pesan.'
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  if (route.name === 'pesan-compose' && canCompose.value) {
    openCompose()
    activeTab.value = 'sent'
  }
  loadData()
})

onUnmounted(() => {
  if (composeTimer.value) clearTimeout(composeTimer.value)
})

async function openPesan(p: PesanRow) {
  if (activeTab.value === 'sent') {
    selectedPesan.value = p
    return
  }
  loadingDetail.value = true
  selectedPesan.value = p
  try {
    await pesanService.get(p.id)
    // Mark as read locally
    p.sudah_dibaca = 1
  } catch {
    // ignore — detail still visible
  } finally {
    loadingDetail.value = false
  }
}

function closePesan() {
  selectedPesan.value = null
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Pesan</h1>
        <p class="text-sm text-slate-500 mt-1">
          <template v-if="canCompose">Sampaikan arahan &amp; pengumuman kepada ustadz</template>
          <template v-else>Pesan dari Kyai &amp; pengurus</template>
        </p>
      </div>
      <button
        v-if="canCompose"
        @click="openCompose"
        class="inline-flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700"
      >
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Tulis Pesan
      </button>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
      <button
        @click="activeTab = 'inbox'; loadData()"
        class="rounded-md px-4 py-2 text-sm font-medium transition"
        :class="activeTab === 'inbox' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
      >Kotak Masuk</button>
      <button
        v-if="canCompose"
        @click="activeTab = 'sent'; loadData()"
        class="rounded-md px-4 py-2 text-sm font-medium transition"
        :class="activeTab === 'sent' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
      >Terkirim</button>
    </div>

    <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ error }}</div>

    <!-- Compose modal -->
    <div v-if="showCompose" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" @click.self="showCompose = false">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">Tulis Pesan</h2>
        <div v-if="composeSuccess" class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{{ composeSuccess }}</div>
        <div v-if="composeError" class="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{{ composeError }}</div>
        <div class="mt-4 space-y-4">
          <div>
            <label class="text-sm font-medium text-slate-700">Tujuan</label>
            <div class="mt-1 flex flex-wrap gap-2">
              <button @click="composeForm.targetMode = 'all'" class="rounded-lg border px-3 py-1.5 text-sm" :class="composeForm.targetMode === 'all' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-300 text-slate-600'">Semua Ustadz</button>
              <button @click="composeForm.targetMode = 'asrama'" class="rounded-lg border px-3 py-1.5 text-sm" :class="composeForm.targetMode === 'asrama' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-300 text-slate-600'">Per Asrama</button>
              <button @click="composeForm.targetMode = 'specific'" class="rounded-lg border px-3 py-1.5 text-sm" :class="composeForm.targetMode === 'specific' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-300 text-slate-600'">Ustadz Tertentu</button>
            </div>
            <select v-if="composeForm.targetMode === 'asrama'" v-model="composeForm.asrama_jenis" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="L">Asrama Putra</option>
              <option value="P">Asrama Putri</option>
            </select>
            <select v-if="composeForm.targetMode === 'specific'" v-model="composeForm.penerima_id" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">— Pilih ustadz —</option>
              <option v-for="r in recipients" :key="r.id" :value="r.id">{{ r.nama_lengkap }}</option>
            </select>
          </div>
          <div>
            <label class="text-sm font-medium text-slate-700">Judul</label>
            <input v-model="composeForm.judul" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Judul pesan" />
          </div>
          <div>
            <label class="text-sm font-medium text-slate-700">Isi Pesan</label>
            <textarea v-model="composeForm.isi" rows="5" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Tulis pesan Anda..."></textarea>
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-slate-700">Prioritas:</label>
            <button @click="composeForm.prioritas = 'biasa'" class="rounded-lg border px-3 py-1.5 text-sm" :class="composeForm.prioritas === 'biasa' ? 'border-slate-500 bg-slate-100' : 'border-slate-300 text-slate-500'">Biasa</button>
            <button @click="composeForm.prioritas = 'penting'" class="rounded-lg border px-3 py-1.5 text-sm" :class="composeForm.prioritas === 'penting' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-500'">Penting</button>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-3">
          <button @click="showCompose = false" class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Batal</button>
          <button @click="sendPesan" :disabled="sending" class="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">{{ sending ? 'Mengirim...' : 'Kirim' }}</button>
        </div>
      </div>
    </div>

    <!-- Detail modal -->
    <div v-if="selectedPesan" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" @click.self="closePesan">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <span v-if="selectedPesan.prioritas === 'penting'" class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Penting</span>
            <h2 class="mt-1 text-lg font-semibold text-slate-900">{{ selectedPesan.judul }}</h2>
          </div>
          <button @click="closePesan" class="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div class="mt-2 text-xs text-slate-400">
          <span v-if="activeTab === 'sent'">Ke: {{ targetLabel(selectedPesan) }}</span>
          <span v-else>Dari: {{ selectedPesan.pengirim_nama || '—' }}</span>
          <span class="ml-3">{{ formatDate(selectedPesan.created_at) }}</span>
        </div>
        <p class="mt-4 whitespace-pre-wrap text-sm text-slate-700">{{ selectedPesan.isi }}</p>
      </div>
    </div>

    <!-- List -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 animate-pulse rounded-xl bg-slate-100"></div>
    </div>

    <div v-else-if="activeTab === 'inbox' && inbox.length === 0" class="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
      Belum ada pesan masuk.
    </div>
    <div v-else-if="activeTab === 'sent' && sent.length === 0" class="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
      Belum ada pesan terkirim.
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="p in (activeTab === 'inbox' ? inbox : sent)"
        :key="p.id"
        class="cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md"
        :class="activeTab === 'inbox' && !p.sudah_dibaca ? 'border-purple-200' : 'border-slate-200'"
        @click="openPesan(p)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span v-if="p.prioritas === 'penting'" class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Penting</span>
              <span v-if="activeTab === 'inbox' && !p.sudah_dibaca" class="h-2 w-2 rounded-full bg-purple-500"></span>
              <h3 class="truncate font-semibold text-slate-900">{{ p.judul }}</h3>
            </div>
            <p class="mt-1 line-clamp-2 text-sm text-slate-600">{{ p.isi }}</p>
            <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span v-if="activeTab === 'sent'">Ke: {{ targetLabel(p) }}</span>
              <span v-else>Dari: {{ p.pengirim_nama || '—' }}</span>
              <span>{{ formatDate(p.created_at) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

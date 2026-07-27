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
  if (composeTimer.value) { clearTimeout(composeTimer.value); composeTimer.value = null }
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
  if (composeForm.value.targetMode === 'specific' && !composeForm.value.penerima_id) {
    composeError.value = 'Pilih ustadz penerima terlebih dahulu.'
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

    <!-- Split-pane layout -->
    <div class="flex flex-col lg:flex-row gap-6 items-start h-[calc(100vh-12rem)] min-h-[500px]">
      <!-- List side -->
      <div class="w-full lg:w-1/3 flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden shrink-0">
        <!-- Tabs & Compose trigger inside the list header -->
        <div class="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div class="flex gap-1 rounded-lg bg-slate-100/80 p-1 w-fit border border-slate-200/50">
            <button
              @click="activeTab = 'inbox'; loadData(); selectedPesan = null; showCompose = false"
              class="rounded-md px-3 py-1.5 text-xs font-semibold transition"
              :class="activeTab === 'inbox' ? 'bg-white text-emerald-700 shadow-xs ring-1 ring-slate-200/50' : 'text-slate-500 hover:text-slate-700'"
            >Kotak Masuk</button>
            <button
              v-if="canCompose"
              @click="activeTab = 'sent'; loadData(); selectedPesan = null; showCompose = false"
              class="rounded-md px-3 py-1.5 text-xs font-semibold transition"
              :class="activeTab === 'sent' ? 'bg-white text-emerald-700 shadow-xs ring-1 ring-slate-200/50' : 'text-slate-500 hover:text-slate-700'"
            >Terkirim</button>
          </div>
        </div>

        <div v-if="loading" class="p-4 space-y-3">
          <div v-for="i in 5" :key="i" class="h-20 animate-pulse rounded-xl bg-slate-100"></div>
        </div>

        <div v-else-if="activeTab === 'inbox' && inbox.length === 0" class="flex-1 flex items-center justify-center p-8 text-center text-sm text-slate-400">
          Belum ada pesan masuk.
        </div>
        <div v-else-if="activeTab === 'sent' && sent.length === 0" class="flex-1 flex items-center justify-center p-8 text-center text-sm text-slate-400">
          Belum ada pesan terkirim.
        </div>

        <div v-else class="flex-1 overflow-y-auto divide-y divide-slate-50 p-2">
          <button
            v-for="p in (activeTab === 'inbox' ? inbox : sent)"
            :key="p.id"
            class="w-full text-left rounded-lg p-3 transition"
            :class="selectedPesan?.id === p.id && !showCompose ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-200' : 'hover:bg-slate-50'"
            @click="openPesan(p); showCompose = false"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span v-if="activeTab === 'inbox' && !p.sudah_dibaca" class="shrink-0 h-1.5 w-1.5 rounded-full bg-purple-500"></span>
                <span v-if="p.prioritas === 'penting'" class="shrink-0 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">!</span>
                <h3 class="truncate text-sm font-semibold" :class="activeTab === 'inbox' && !p.sudah_dibaca ? 'text-slate-900' : 'text-slate-700'">{{ p.judul }}</h3>
              </div>
            </div>
            <p class="mt-1 line-clamp-2 text-xs text-slate-500 leading-relaxed">{{ p.isi }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400 font-medium">
              <span v-if="activeTab === 'sent'">Kpd: {{ targetLabel(p) }}</span>
              <span v-else>{{ p.pengirim_nama || '—' }}</span>
              <span class="text-slate-300">•</span>
              <span>{{ formatDate(p.created_at) }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- Detail / Compose side -->
      <div class="w-full lg:w-2/3 h-full flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden" :class="{'hidden lg:flex': !showCompose && !selectedPesan}">
        <!-- Empty state detail -->
        <div v-if="!showCompose && !selectedPesan" class="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/30">
          <div class="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-4 ring-8 ring-white">
            <svg class="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <p class="text-sm font-medium text-slate-500">Pilih pesan untuk dibaca</p>
        </div>

        <!-- Compose view -->
        <div v-else-if="showCompose" class="flex flex-col h-full">
          <div class="p-4 sm:p-6 border-b border-purple-100 bg-gradient-to-r from-purple-50 to-white flex justify-between items-center">
            <h2 class="text-lg font-bold text-purple-900">Tulis Pesan Baru</h2>
            <button @click="showCompose = false" class="rounded-lg p-1 text-purple-400 hover:bg-purple-100 lg:hidden">
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          
          <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <div v-if="composeSuccess" class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">{{ composeSuccess }}</div>
            <div v-if="composeError" class="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">{{ composeError }}</div>
            
            <div class="space-y-5">
              <div>
                <label class="text-xs font-bold uppercase tracking-wider text-slate-500">Kirim Kepada</label>
                <div class="mt-2 flex flex-wrap gap-2">
                  <button @click="composeForm.targetMode = 'all'" class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition" :class="composeForm.targetMode === 'all' ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500/20' : 'border-slate-200 text-slate-600 hover:bg-slate-50'">Semua Ustadz</button>
                  <button @click="composeForm.targetMode = 'asrama'" class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition" :class="composeForm.targetMode === 'asrama' ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500/20' : 'border-slate-200 text-slate-600 hover:bg-slate-50'">Per Asrama</button>
                  <button @click="composeForm.targetMode = 'specific'" class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition" :class="composeForm.targetMode === 'specific' ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500/20' : 'border-slate-200 text-slate-600 hover:bg-slate-50'">Ustadz Tertentu</button>
                </div>
                <div class="mt-3">
                  <select v-if="composeForm.targetMode === 'asrama'" v-model="composeForm.asrama_jenis" class="w-full sm:w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 bg-white shadow-xs">
                    <option value="L">Asrama Putra</option>
                    <option value="P">Asrama Putri</option>
                  </select>
                  <select v-if="composeForm.targetMode === 'specific'" v-model="composeForm.penerima_id" class="w-full sm:w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 bg-white shadow-xs">
                    <option value="">— Pilih ustadz —</option>
                    <option v-for="r in recipients" :key="r.id" :value="r.id">{{ r.nama_lengkap }}</option>
                  </select>
                </div>
              </div>
              
              <div class="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:items-center">
                <label class="text-xs font-bold uppercase tracking-wider text-slate-500 sm:w-20">Judul</label>
                <input v-model="composeForm.judul" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 shadow-xs font-medium" placeholder="Judul ringkas..." />
              </div>
              
              <div>
                <textarea v-model="composeForm.isi" rows="10" class="w-full rounded-xl border border-slate-300 p-4 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 shadow-xs resize-none" placeholder="Tulis pesan lengkap di sini..."></textarea>
              </div>
              
              <div class="flex items-center gap-3">
                <label class="text-xs font-bold uppercase tracking-wider text-slate-500">Prioritas</label>
                <div class="flex gap-2">
                  <label class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition" :class="composeForm.prioritas === 'biasa' ? 'border-slate-500 bg-slate-100 text-slate-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'">
                    <input v-model="composeForm.prioritas" type="radio" value="biasa" class="sr-only" /> Biasa
                  </label>
                  <label class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition" :class="composeForm.prioritas === 'penting' ? 'border-rose-500 bg-rose-50 text-rose-700 ring-1 ring-rose-500/20' : 'border-slate-200 text-slate-500 hover:bg-slate-50'">
                    <input v-model="composeForm.prioritas" type="radio" value="penting" class="sr-only" /> Penting
                  </label>
                </div>
              </div>
            </div>
          </div>
          
          <div class="p-4 sm:p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 mt-auto">
            <button @click="showCompose = false" class="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 shadow-xs">Batal</button>
            <button @click="sendPesan" :disabled="sending" class="rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-purple-700 shadow-sm disabled:opacity-50 flex items-center gap-2">
              <svg v-if="sending" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
              {{ sending ? 'Mengirim...' : 'Kirim Pesan' }}
            </button>
          </div>
        </div>

        <!-- Detail view -->
        <div v-else-if="selectedPesan" class="flex flex-col h-full relative">
          <button @click="closePesan" class="absolute top-4 right-4 rounded-lg p-1.5 bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition lg:hidden">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          
          <div class="p-6 sm:p-8 border-b border-slate-100 bg-slate-50/30 pr-12 lg:pr-8">
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <span v-if="selectedPesan.prioritas === 'penting'" class="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-rose-700">Penting</span>
              <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">{{ activeTab === 'sent' ? 'Pesan Terkirim' : 'Pesan Masuk' }}</span>
            </div>
            <h2 class="text-2xl font-bold text-slate-900 leading-snug">{{ selectedPesan.judul }}</h2>
            <div class="mt-4 flex flex-wrap items-center gap-y-2 gap-x-4 text-sm font-medium">
              <div class="flex items-center gap-2">
                <div class="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                  {{ (activeTab === 'sent' ? targetLabel(selectedPesan) : (selectedPesan.pengirim_nama || '?')).charAt(0).toUpperCase() }}
                </div>
                <span class="text-slate-700">{{ activeTab === 'sent' ? 'Kepada: ' + targetLabel(selectedPesan) : 'Dari: ' + (selectedPesan.pengirim_nama || '—') }}</span>
              </div>
              <span class="text-slate-300">•</span>
              <span class="text-slate-500">{{ formatDate(selectedPesan.created_at) }}</span>
            </div>
          </div>
          
          <div class="flex-1 overflow-y-auto p-6 sm:p-8">
            <div class="prose prose-sm sm:prose-base prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">
              {{ selectedPesan.isi }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

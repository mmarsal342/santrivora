<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { personelService } from '@/services'

interface Kamar { id: string; nama: string; jenis_kelamin: 'L' | 'P' }
interface Kelas { id: string; nama: string; tingkatan: string | null }
interface Personel {
  id: string
  nama_lengkap: string
  email: string
  role: 'admin' | 'ustadz' | 'kyai' | 'kepala_asrama'
  asrama_jenis?: 'L' | 'P' | null
  status: 'pending' | 'approved' | 'suspended'
  assigned_kelas: Kelas[]
  assigned_kamar: Kamar[]
}

const router = useRouter()

const personel = ref<Personel[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const filterRole = ref('')

const roleOptions = [
  { value: '', label: 'Semua Peran' },
  { value: 'admin', label: 'Admin' },
  { value: 'kyai', label: 'Kyai' },
  { value: 'kepala_asrama', label: 'Kepala Asrama' },
  { value: 'ustadz', label: 'Ustadz/ustadzah' }
]

function roleBadge(role: string): string {
  switch (role) {
    case 'admin': return 'bg-amber-100 text-amber-800'
    case 'kyai': return 'bg-purple-100 text-purple-800'
    case 'kepala_asrama': return 'bg-sky-100 text-sky-800'
    default: return 'bg-blue-100 text-blue-800'
  }
}

function roleLabel(role: string, asrama?: string | null): string {
  switch (role) {
    case 'admin': return 'Admin'
    case 'kyai': return 'Kyai'
    case 'kepala_asrama': return asrama === 'P' ? 'Kepala Putri' : asrama === 'L' ? 'Kepala Putra' : 'Kepala Asrama'
    default: return 'Ustadz'
  }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return personel.value
  return personel.value.filter((p) => p.nama_lengkap.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
})

async function fetchPersonel() {
  loading.value = true
  error.value = ''
  try {
    const res = await personelService.list({ role: filterRole.value || undefined, limit: 200 })
    personel.value = res.data ?? []
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat data personel'
  } finally {
    loading.value = false
  }
}

function openDetail(id: string) {
  router.push({ name: 'personel-detail', params: { id } })
}

onMounted(fetchPersonel)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Profil Personel</h1>
      <p class="text-sm text-gray-500">Data ustadz/ustadzah, kyai, dan pengelola pesantren</p>
    </div>

    <div class="flex flex-wrap gap-3">
      <input
        v-model="search"
        type="text"
        placeholder="Cari nama atau email..."
        class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <select
        v-model="filterRole"
        @change="fetchPersonel"
        class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 animate-pulse rounded-xl bg-gray-100"></div>
    </div>

    <div
      v-else-if="filtered.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"
    >
      <p class="text-sm font-medium text-gray-600">Tidak ada personel ditemukan</p>
    </div>

    <div v-else class="space-y-3">
      <button
        v-for="p in filtered"
        :key="p.id"
        type="button"
        @click="openDetail(p.id)"
        class="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
          {{ p.nama_lengkap.charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate font-semibold text-gray-900">{{ p.nama_lengkap }}</p>
            <span :class="['inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', roleBadge(p.role)]">
              {{ roleLabel(p.role, p.asrama_jenis) }}
            </span>
          </div>
          <p class="truncate text-sm text-gray-500">{{ p.email }}</p>
          <div v-if="p.assigned_kamar.length > 0 || p.assigned_kelas.length > 0" class="mt-1 flex flex-wrap gap-1">
            <span v-for="k in p.assigned_kamar" :key="'kamar-' + k.id" class="inline-flex rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
              {{ k.nama }}
            </span>
            <span v-for="k in p.assigned_kelas" :key="'kelas-' + k.id" class="inline-flex rounded-md bg-violet-50 px-2 py-0.5 text-xs text-violet-700">
              {{ k.nama }}
            </span>
          </div>
        </div>
        <svg class="h-5 w-5 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  </div>
</template>

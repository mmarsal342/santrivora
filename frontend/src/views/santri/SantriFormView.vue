<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { santriService, kelasService, kamarService } from '@/services'

interface Kelas {
  id: string
  nama: string
}

interface Kamar {
  id: string
  nama: string
  jenis_kelamin: 'L' | 'P'
}

const route = useRoute()
const router = useRouter()

const isEdit = computed(() => route.name === 'santri-edit')
const editId = computed(() => (route.params.id ? String(route.params.id) : ''))

const kelasOptions = ref<Kelas[]>([])
const kamarOptions = ref<Kamar[]>([])
const loading = ref(false)
const submitting = ref(false)
const serverError = ref('')

const form = reactive({
  nama_lengkap: '',
  jenis_kelamin: 'L' as 'L' | 'P',
  kelas_id: '',
  kamar_id: '',
  angkatan: '',
  tanggal_masuk: '',
  tanggal_lahir: '',
  love_language: '',
  status: 'aktif',
})

const kamarOptionsForGender = computed(() => kamarOptions.value.filter((k) => k.jenis_kelamin === form.jenis_kelamin))

// Reset kamar_id if it's no longer valid for the selected gender
watch(() => form.jenis_kelamin, () => {
  if (form.kamar_id && !kamarOptionsForGender.value.some((k) => k.id === form.kamar_id)) {
    form.kamar_id = ''
  }
})

const errors = reactive<Record<string, string>>({
  nama_lengkap: '',
  jenis_kelamin: '',
  tanggal_masuk: '',
})

const statusOptions = [
  { value: 'aktif', label: 'Aktif' },
  { value: 'lulus', label: 'Lulus' },
  { value: 'keluar', label: 'Keluar' },
]

const today = new Date().toISOString().slice(0, 10)

function validate() {
  errors.nama_lengkap = ''
  errors.jenis_kelamin = ''
  errors.tanggal_masuk = ''
  let valid = true
  if (!form.nama_lengkap.trim()) {
    errors.nama_lengkap = 'Nama lengkap wajib diisi.'
    valid = false
  }
  if (!['L', 'P'].includes(form.jenis_kelamin)) {
    errors.jenis_kelamin = 'Pilih jenis kelamin.'
    valid = false
  }
  if (!form.tanggal_masuk) {
    errors.tanggal_masuk = 'Tanggal masuk wajib diisi.'
    valid = false
  }
  return valid
}

async function loadKelas() {
  try {
    kelasOptions.value = await kelasService.list()
  } catch {
    kelasOptions.value = []
  }
}

async function loadKamar() {
  try {
    kamarOptions.value = (await kamarService.list()) as Kamar[]
    if (!isEdit.value && kamarOptions.value.length === 1 && !form.kamar_id) {
      form.kamar_id = kamarOptions.value[0].id
      form.jenis_kelamin = kamarOptions.value[0].jenis_kelamin
    }
  } catch {
    kamarOptions.value = []
  }
}

async function loadSantri() {
  if (!isEdit.value) {
    form.tanggal_masuk = today
    return
  }
  loading.value = true
  try {
    const s = await santriService.get(editId.value)
    form.nama_lengkap = s.nama_lengkap ?? ''
    form.jenis_kelamin = (s.jenis_kelamin as 'L' | 'P') ?? 'L'
    form.kelas_id = s.kelas?.id ?? s.kelas_id ?? ''
    form.kamar_id = s.kamar?.id ?? s.kamar_id ?? ''
    form.angkatan = s.angkatan != null ? String(s.angkatan) : ''
    form.tanggal_masuk = s.tanggal_masuk ? s.tanggal_masuk.slice(0, 10) : ''
    form.tanggal_lahir = s.tanggal_lahir ? s.tanggal_lahir.slice(0, 10) : ''
    form.love_language = s.love_language ?? ''
    form.status = s.status ?? 'aktif'
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    serverError.value = err?.response?.data?.message || 'Gagal memuat data santri.'
  } finally {
    loading.value = false
  }
}

async function submit() {
  serverError.value = ''
  if (!validate()) return

  const payload: Record<string, unknown> = {
    nama_lengkap: form.nama_lengkap.trim(),
    jenis_kelamin: form.jenis_kelamin,
    tanggal_masuk: form.tanggal_masuk,
    status: form.status,
  }
  if (form.kelas_id) payload.kelas_id = form.kelas_id
  if (form.kamar_id) payload.kamar_id = form.kamar_id
  if (form.angkatan.trim()) payload.angkatan = form.angkatan.trim()
  if (form.tanggal_lahir) payload.tanggal_lahir = form.tanggal_lahir
  if (form.love_language.trim()) payload.love_language = form.love_language.trim()

  submitting.value = true
  try {
    let savedId: string
    if (isEdit.value) {
      const updated = await santriService.update(editId.value, payload)
      savedId = (updated as { id: string }).id || editId.value
    } else {
      const created = await santriService.create(payload)
      savedId = (created as { id: string }).id
    }
    router.push({ name: 'santri-detail', params: { id: savedId } })
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string; errors?: Record<string, string> } } }
    serverError.value = err?.response?.data?.message || 'Gagal menyimpan data santri.'
    if (err?.response?.data?.errors) {
      const fieldErrors = err.response.data.errors
      if (fieldErrors.nama_lengkap) errors.nama_lengkap = fieldErrors.nama_lengkap
      if (fieldErrors.jenis_kelamin) errors.jenis_kelamin = fieldErrors.jenis_kelamin
      if (fieldErrors.tanggal_masuk) errors.tanggal_masuk = fieldErrors.tanggal_masuk
    }
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadKelas(), loadKamar(), loadSantri()])
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5">
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

    <div class="flex items-center gap-3">
      <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
        <svg class="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path v-if="isEdit" stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          <path v-else stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
      </div>
      <div>
        <h1 class="text-2xl font-bold text-slate-900">{{ isEdit ? 'Edit Santri' : 'Tambah Santri' }}</h1>
        <p class="text-sm text-slate-500">{{ isEdit ? 'Perbarui informasi santri.' : 'Lengkapi data santri baru.' }}</p>
      </div>
    </div>

    <!-- Server error -->
    <div v-if="serverError" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ serverError }}</div>

    <!-- Loading -->
    <div v-if="loading" class="animate-pulse space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div class="h-10 rounded bg-slate-200"></div>
      <div class="h-10 rounded bg-slate-100"></div>
      <div class="h-10 rounded bg-slate-100"></div>
    </div>

    <!-- Form -->
    <form v-else @submit.prevent="submit" class="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <!-- Nama lengkap -->
      <div>
        <label for="nama_lengkap" class="mb-1.5 block text-sm font-medium text-slate-700">
          Nama Lengkap <span class="text-rose-500">*</span>
        </label>
        <input
          id="nama_lengkap"
          v-model="form.nama_lengkap"
          type="text"
          placeholder="Nama lengkap santri"
          class="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          :class="errors.nama_lengkap ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/20' : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-500/20'"
        />
        <p v-if="errors.nama_lengkap" class="mt-1 text-xs text-rose-600">{{ errors.nama_lengkap }}</p>
      </div>

      <!-- Jenis kelamin -->
      <div>
        <span class="mb-1.5 block text-sm font-medium text-slate-700">Jenis Kelamin <span class="text-rose-500">*</span></span>
        <div class="grid grid-cols-2 gap-3">
          <label
            class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition"
            :class="form.jenis_kelamin === 'L' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'"
          >
            <input v-model="form.jenis_kelamin" type="radio" value="L" class="sr-only" />
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Laki-laki
          </label>
          <label
            class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition"
            :class="form.jenis_kelamin === 'P' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'"
          >
            <input v-model="form.jenis_kelamin" type="radio" value="P" class="sr-only" />
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Perempuan
          </label>
        </div>
        <p v-if="errors.jenis_kelamin" class="mt-1 text-xs text-rose-600">{{ errors.jenis_kelamin }}</p>
      </div>

      <!-- Kelas & Kamar -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="kelas_id" class="mb-1.5 block text-sm font-medium text-slate-700">Kelas</label>
          <select
            id="kelas_id"
            v-model="form.kelas_id"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
          >
            <option value="">Tanpa kelas</option>
            <option v-for="k in kelasOptions" :key="k.id" :value="k.id">{{ k.nama }}</option>
          </select>
        </div>
        <div>
          <label for="kamar_id" class="mb-1.5 block text-sm font-medium text-slate-700">Kamar</label>
          <select
            id="kamar_id"
            v-model="form.kamar_id"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
          >
            <option value="">Tanpa kamar</option>
            <option v-for="k in kamarOptionsForGender" :key="k.id" :value="k.id">{{ k.nama }}</option>
          </select>
        </div>
      </div>

      <!-- Angkatan & Tanggal masuk -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="angkatan" class="mb-1.5 block text-sm font-medium text-slate-700">Angkatan</label>
          <input
            id="angkatan"
            v-model="form.angkatan"
            type="text"
            inputmode="numeric"
            placeholder="Mis. 2024"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div>
          <label for="tanggal_masuk" class="mb-1.5 block text-sm font-medium text-slate-700">
            Tanggal Masuk <span class="text-rose-500">*</span>
          </label>
          <input
            id="tanggal_masuk"
            v-model="form.tanggal_masuk"
            type="date"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            :class="errors.tanggal_masuk ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/20' : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-500/20'"
          />
          <p v-if="errors.tanggal_masuk" class="mt-1 text-xs text-rose-600">{{ errors.tanggal_masuk }}</p>
        </div>
      </div>

      <!-- Tanggal lahir & Love language -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="tanggal_lahir" class="mb-1.5 block text-sm font-medium text-slate-700">Tanggal Lahir</label>
          <input
            id="tanggal_lahir"
            v-model="form.tanggal_lahir"
            type="date"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div>
          <label for="love_language" class="mb-1.5 block text-sm font-medium text-slate-700">Love Language</label>
          <input
            id="love_language"
            v-model="form.love_language"
            type="text"
            placeholder="Opsional, mis. Words of Affirmation"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
      </div>

      <!-- Status (only in edit mode — create defaults to 'aktif') -->
      <div v-if="isEdit">
        <label for="status" class="mb-1.5 block text-sm font-medium text-slate-700">Status</label>
        <select
          id="status"
          v-model="form.status"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
        >
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>

      <!-- Actions -->
      <div class="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
        <button
          type="button"
          @click="router.back()"
          :disabled="submitting"
          class="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >Batal</button>
        <button
          type="submit"
          :disabled="submitting"
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          <svg v-if="submitting" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          {{ submitting ? 'Menyimpan...' : (isEdit ? 'Simpan Perubahan' : 'Simpan Santri') }}
        </button>
      </div>
    </form>
  </div>
</template>

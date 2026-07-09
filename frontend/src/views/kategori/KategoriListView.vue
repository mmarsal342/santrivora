<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { kategoriService } from '@/services'

interface Kategori {
  id: string
  nama: string
  deskripsi?: string
  urutan_keparahan?: number
  catatan_count?: number
}

const list = ref<Kategori[]>([])
const loading = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const deleteTarget = ref<Kategori | null>(null)

const form = reactive({
  nama: '',
  deskripsi: '',
  urutan_keparahan: 1
})

function resetForm() {
  form.nama = ''
  form.deskripsi = ''
  form.urutan_keparahan = 1
  editingId.value = null
}

async function fetchList() {
  loading.value = true
  error.value = ''
  try {
    list.value = (await kategoriService.list()) as Kategori[]
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat kategori'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  error.value = ''
  resetForm()
  modalOpen.value = true
}

function openEdit(k: Kategori) {
  error.value = ''
  editingId.value = k.id
  form.nama = k.nama
  form.deskripsi = k.deskripsi ?? ''
  form.urutan_keparahan = k.urutan_keparahan ?? 1
  modalOpen.value = true
}

async function submit() {
  if (!form.nama.trim()) {
    error.value = 'Nama kategori wajib diisi'
    return
  }
  submitting.value = true
  try {
    const payload = {
      nama: form.nama,
      deskripsi: form.deskripsi || undefined,
      urutan_keparahan: Number(form.urutan_keparahan) || 1
    }
    if (editingId.value) {
      await kategoriService.update(editingId.value, payload)
    } else {
      await kategoriService.create(payload)
    }
    modalOpen.value = false
    resetForm()
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menyimpan kategori'
  } finally {
    submitting.value = false
  }
}

function confirmDelete(k: Kategori) {
  deleteTarget.value = k
}

async function doDelete() {
  if (!deleteTarget.value) return
  try {
    await kategoriService.remove(deleteTarget.value.id)
    list.value = list.value.filter((k) => k.id !== deleteTarget.value!.id)
    deleteTarget.value = null
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menghapus kategori'
  }
}

function severityColor(level: number): string {
  if (level <= 2) return 'bg-green-500'
  if (level <= 4) return 'bg-yellow-500'
  if (level <= 7) return 'bg-orange-500'
  return 'bg-red-600'
}

function severityLabel(level: number): string {
  if (level <= 2) return 'Ringan'
  if (level <= 4) return 'Sedang'
  if (level <= 7) return 'Berat'
  return 'Sangat Berat'
}

onMounted(fetchList)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Kategori Pelanggaran</h1>
        <p class="text-sm text-gray-500">Kelola kategori dan tingkat keparahan</p>
      </div>
      <button
        type="button"
        @click="openCreate"
        class="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        + Tambah Kategori
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 3" :key="i" class="h-36 animate-pulse rounded-xl bg-gray-100"></div>
    </div>

    <div
      v-else-if="list.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"
    >
      <svg class="mb-3 h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      <p class="text-sm font-medium text-gray-600">Belum ada kategori</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="k in list"
        :key="k.id"
        class="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
      >
        <div class="mb-2 flex items-start justify-between gap-2">
          <h3 class="font-semibold text-gray-900">{{ k.nama }}</h3>
          <div class="flex shrink-0 gap-1">
            <button
              type="button"
              @click="openEdit(k)"
              class="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              title="Edit"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              type="button"
              @click="confirmDelete(k)"
              class="rounded-md p-1.5 text-red-500 transition hover:bg-red-50"
              title="Hapus"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </button>
          </div>
        </div>

        <p class="mb-3 line-clamp-2 flex-1 text-sm text-gray-500">
          {{ k.deskripsi || 'Tidak ada deskripsi' }}
        </p>

        <div class="mb-1 flex items-center justify-between text-xs text-gray-500">
          <span>Tingkat Keparahan</span>
          <span class="font-medium text-gray-700">{{ severityLabel(k.urutan_keparahan ?? 1) }}</span>
        </div>
        <div class="mb-3 flex gap-0.5">
          <div
            v-for="i in 10"
            :key="i"
            :class="[
              'h-2 flex-1 rounded-full',
              i <= (k.urutan_keparahan ?? 1) ? severityColor(k.urutan_keparahan ?? 1) : 'bg-gray-100'
            ]"
          ></div>
        </div>

        <div class="flex items-center gap-1.5 text-xs text-gray-400">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>{{ k.catatan_count ?? 0 }} catatan</span>
        </div>
      </div>
    </div>

    <div
      v-if="modalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="modalOpen = false"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">
          {{ editingId ? 'Edit Kategori' : 'Tambah Kategori' }}
        </h2>
        <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</div>
        <form class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Nama <span class="text-red-500">*</span></label>
            <input
              v-model="form.nama"
              type="text"
              placeholder="mis. Terlambat"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Deskripsi</label>
            <textarea
              v-model="form.deskripsi"
              rows="2"
              placeholder="Penjelasan kategori..."
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            ></textarea>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">
              Urutan Keparahan: <span class="font-semibold text-emerald-700">{{ form.urutan_keparahan }}</span>
            </label>
            <input
              v-model.number="form.urutan_keparahan"
              type="range"
              min="1"
              max="10"
              class="w-full accent-emerald-600"
            />
            <div class="flex justify-between text-xs text-gray-400">
              <span>Ringan</span>
              <span>Sangat Berat</span>
            </div>
          </div>
          <div class="flex gap-3 pt-2">
            <button
              type="submit"
              :disabled="submitting"
              class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {{ submitting ? 'Menyimpan...' : 'Simpan' }}
            </button>
            <button
              type="button"
              @click="modalOpen = false"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Batal
            </button>
          </div>
        </form>
      </div>
    </div>

    <div
      v-if="deleteTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="deleteTarget = null"
    >
      <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div class="mb-2 flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg class="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="text-base font-semibold text-gray-900">Hapus Kategori</h3>
        </div>
        <p class="mb-4 text-sm text-gray-600">
          Yakin ingin menghapus <strong>{{ deleteTarget.nama }}</strong>?
        </p>
        <div
          v-if="(deleteTarget.catatan_count ?? 0) > 0"
          class="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800"
        >
          ⚠️ Kategori ini terkait dengan {{ deleteTarget.catatan_count }} catatan. Menghapus dapat memengaruhi data terkait.
        </div>
        <div class="flex gap-3">
          <button
            type="button"
            @click="doDelete"
            class="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Hapus
          </button>
          <button
            type="button"
            @click="deleteTarget = null"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

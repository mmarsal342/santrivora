<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { kelasService } from '@/services'

interface Kelas {
  id: string
  nama: string
  tingkatan?: string
  tahun_ajaran?: string
  jumlah_santri?: number
  is_active?: boolean
}

const list = ref<Kelas[]>([])
const loading = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const deleteTarget = ref<Kelas | null>(null)
const deleteWarning = ref('')

const form = reactive({
  nama: '',
  tingkatan: '',
  tahun_ajaran: ''
})

function resetForm() {
  form.nama = ''
  form.tingkatan = ''
  form.tahun_ajaran = ''
  editingId.value = null
}

async function fetchList() {
  loading.value = true
  error.value = ''
  try {
    list.value = (await kelasService.list()) as Kelas[]
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal memuat kelas'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  resetForm()
  modalOpen.value = true
}

function openEdit(k: Kelas) {
  editingId.value = k.id
  form.nama = k.nama
  form.tingkatan = k.tingkatan ?? ''
  form.tahun_ajaran = k.tahun_ajaran ?? ''
  modalOpen.value = true
}

async function submit() {
  if (!form.nama.trim()) {
    error.value = 'Nama kelas wajib diisi'
    return
  }
  submitting.value = true
  try {
    const payload = {
      nama: form.nama,
      tingkatan: form.tingkatan || undefined,
      tahun_ajaran: form.tahun_ajaran || undefined
    }
    if (editingId.value) {
      await kelasService.update(editingId.value, payload)
    } else {
      await kelasService.create(payload)
    }
    modalOpen.value = false
    resetForm()
    await fetchList()
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal menyimpan kelas'
  } finally {
    submitting.value = false
  }
}

function confirmDelete(k: Kelas) {
  deleteTarget.value = k
  deleteWarning.value =
    (k.jumlah_santri ?? 0) > 0
      ? `Kelas ini memiliki ${k.jumlah_santri} santri. Yakin ingin menghapus?`
      : 'Yakin ingin menghapus kelas ini?'
}

async function doDelete() {
  if (!deleteTarget.value) return
  try {
    await kelasService.remove(deleteTarget.value.id)
    list.value = list.value.filter((k) => k.id !== deleteTarget.value!.id)
    deleteTarget.value = null
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal menghapus kelas'
  }
}

onMounted(fetchList)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Manajemen Kelas</h1>
        <p class="text-sm text-gray-500">Kelola data kelas pondok</p>
      </div>
      <button
        type="button"
        @click="openCreate"
        class="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        + Tambah Kelas
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 4" :key="i" class="h-14 animate-pulse rounded-lg bg-gray-100"></div>
    </div>

    <div
      v-else-if="list.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"
    >
      <svg class="mb-3 h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
      </svg>
      <p class="text-sm font-medium text-gray-600">Belum ada kelas</p>
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Nama</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tingkatan</th>
              <th class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 sm:table-cell">Tahun Ajaran</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Santri</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
              <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="k in list" :key="k.id" class="transition hover:bg-gray-50">
              <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ k.nama }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{{ k.tingkatan || '-' }}</td>
              <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600 sm:table-cell">{{ k.tahun_ajaran || '-' }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{{ k.jumlah_santri ?? 0 }}</td>
              <td class="px-4 py-3">
                <span
                  :class="[
                    'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                    k.is_active !== false
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-600'
                  ]"
                >
                  {{ k.is_active !== false ? 'Aktif' : 'Nonaktif' }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <button
                  type="button"
                  @click="openEdit(k)"
                  class="mr-1 rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  title="Edit"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  type="button"
                  @click="confirmDelete(k)"
                  class="rounded-md p-1.5 text-red-600 transition hover:bg-red-50"
                  title="Hapus"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      v-if="modalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="modalOpen = false"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">
          {{ editingId ? 'Edit Kelas' : 'Tambah Kelas' }}
        </h2>
        <form class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Nama <span class="text-red-500">*</span></label>
            <input
              v-model="form.nama"
              type="text"
              placeholder="mis. Kelas 1A"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Tingkatan</label>
            <input
              v-model="form.tingkatan"
              type="text"
              placeholder="mis. Ibtidaiyah"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Tahun Ajaran</label>
            <input
              v-model="form.tahun_ajaran"
              type="text"
              placeholder="mis. 2025/2026"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
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
          <h3 class="text-base font-semibold text-gray-900">Hapus Kelas</h3>
        </div>
        <p class="mb-4 text-sm text-gray-600">{{ deleteWarning }}</p>
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

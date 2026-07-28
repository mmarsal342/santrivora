<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { kamarService } from '@/services'
import EmptyState from '@/components/EmptyState.vue'

interface Kamar {
  id: string
  nama: string
  jenis_kelamin: 'L' | 'P'
  kapasitas?: number | null
  jumlah_santri?: number
  is_active?: number
}

const list = ref<Kamar[]>([])
const loading = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const deleteTarget = ref<Kamar | null>(null)
const deleteWarning = ref('')
const filterStatus = ref<'aktif' | 'nonaktif' | 'semua'>('aktif')

const form = reactive({
  nama: '',
  jenis_kelamin: 'L' as 'L' | 'P',
  kapasitas: '' as string | number,
  is_active: true
})

function resetForm() {
  form.nama = ''
  form.jenis_kelamin = 'L'
  form.kapasitas = ''
  form.is_active = true
  editingId.value = null
}

async function fetchList() {
  loading.value = true
  error.value = ''
  try {
    list.value = (await kamarService.list({ status: filterStatus.value })) as Kamar[]
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat kamar'
  } finally {
    loading.value = false
  }
}

watch(filterStatus, fetchList)

function openCreate() {
  error.value = ''
  resetForm()
  modalOpen.value = true
}

function openEdit(k: Kamar) {
  error.value = ''
  editingId.value = k.id
  form.nama = k.nama
  form.jenis_kelamin = k.jenis_kelamin
  form.kapasitas = k.kapasitas ?? ''
  form.is_active = k.is_active !== 0
  modalOpen.value = true
}

async function submit() {
  if (!form.nama.trim()) {
    error.value = 'Nama kamar wajib diisi'
    return
  }
  submitting.value = true
  try {
    const payload: Record<string, unknown> = {
      nama: form.nama,
      jenis_kelamin: form.jenis_kelamin
    }
    if (form.kapasitas !== '') payload.kapasitas = Number(form.kapasitas)
    if (editingId.value) {
      payload.is_active = form.is_active ? 1 : 0
      await kamarService.update(editingId.value, payload)
    } else {
      await kamarService.create(payload as { nama: string; jenis_kelamin: 'L' | 'P'; kapasitas?: number })
    }
    modalOpen.value = false
    resetForm()
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menyimpan kamar'
  } finally {
    submitting.value = false
  }
}

function confirmDelete(k: Kamar) {
  deleteTarget.value = k
  deleteWarning.value =
    (k.jumlah_santri ?? 0) > 0
      ? `Kamar ini memiliki ${k.jumlah_santri} santri. Yakin ingin menghapus?`
      : 'Yakin ingin menghapus kamar ini?'
}

async function doDelete() {
  if (!deleteTarget.value) return
  try {
    await kamarService.remove(deleteTarget.value.id)
    list.value = list.value.filter((k) => k.id !== deleteTarget.value!.id)
    deleteTarget.value = null
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menghapus kamar'
  }
}

onMounted(fetchList)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Manajemen Kamar</h1>
        <p class="text-sm text-gray-500">Kelola data kamar pondok</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="filterStatus"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="aktif">Aktif</option>
          <option value="nonaktif">Nonaktif</option>
          <option value="semua">Semua</option>
        </select>
        <button
          type="button"
          @click="openCreate"
          class="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        >
          + Tambah Kamar
        </button>
      </div>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 4" :key="i" class="h-14 animate-pulse rounded-lg bg-gray-100"></div>
    </div>

    <EmptyState
      v-else-if="list.length === 0"
      title="Belum ada kamar"
      description="Tambahkan kamar untuk asrama putra maupun putri."
      action-label="+ Tambah Kamar"
      @action="openCreate"
    />

    <div v-else class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Nama</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Jenis Kelamin</th>
              <th class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 sm:table-cell">Kapasitas</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Santri</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
              <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="k in list" :key="k.id" class="transition hover:bg-gray-50">
              <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ k.nama }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{{ k.jenis_kelamin === 'P' ? 'Putri' : 'Putra' }}</td>
              <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600 sm:table-cell">{{ k.kapasitas ?? '-' }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{{ k.jumlah_santri ?? 0 }}</td>
              <td class="px-4 py-3">
                <span
                  :class="[
                    'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                    k.is_active !== 0
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-600'
                  ]"
                >
                  {{ k.is_active !== 0 ? 'Aktif' : 'Nonaktif' }}
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
          {{ editingId ? 'Edit Kamar' : 'Tambah Kamar' }}
        </h2>
        <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</div>
        <form class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Nama <span class="text-red-500">*</span></label>
            <input
              v-model="form.nama"
              type="text"
              placeholder="mis. Kamar Putra 1"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Jenis Kelamin <span class="text-red-500">*</span></label>
            <div class="grid grid-cols-2 gap-3">
              <label
                :class="[
                  'flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition',
                  form.jenis_kelamin === 'L'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                ]"
              >
                <input v-model="form.jenis_kelamin" type="radio" value="L" class="sr-only" />
                Putra
              </label>
              <label
                :class="[
                  'flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition',
                  form.jenis_kelamin === 'P'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                ]"
              >
                <input v-model="form.jenis_kelamin" type="radio" value="P" class="sr-only" />
                Putri
              </label>
            </div>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Kapasitas</label>
            <input
              v-model="form.kapasitas"
              type="number"
              min="0"
              placeholder="mis. 10"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <label v-if="editingId" class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition hover:bg-gray-50">
            <input v-model="form.is_active" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
            <span class="text-sm text-gray-700">Kamar aktif</span>
          </label>
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
          <h3 class="text-base font-semibold text-gray-900">Hapus Kamar</h3>
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

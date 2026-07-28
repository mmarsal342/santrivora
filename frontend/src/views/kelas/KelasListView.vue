<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { kelasService } from '@/services'
import { useEntityList } from '@/offline/composables/useEntityList'
import { useEntityMutation } from '@/offline/composables/useEntityMutation'
import { pullAll } from '@/offline/sync/engine'

interface Kelas {
  id: string
  nama: string
  tingkatan?: string
  tahun_ajaran?: string
  is_active?: number
}

interface Santri {
  id: string
  kelas_id: string | null
  status: string
}

// kelas 'pull-only' — mirror kamar. jumlah_santri yang dulu lewat JOIN server
// sekarang dihitung client-side dari cache santri (sudah ikut ke-pull juga).
const { items: list, loading } = useEntityList<Kelas>('kelas', {
  sort: (a, b) => (a.tingkatan ?? '').localeCompare(b.tingkatan ?? '') || a.nama.localeCompare(b.nama),
  pageSize: 1000
})
const { allItems: allSantri } = useEntityList<Santri>('santri')
const jumlahSantriByKelas = computed(() => {
  const map = new Map<string, number>()
  for (const s of allSantri.value) {
    if (s.status !== 'aktif' || !s.kelas_id) continue
    map.set(s.kelas_id, (map.get(s.kelas_id) ?? 0) + 1)
  }
  return map
})

const mutation = useEntityMutation<Kelas>('kelas')

const error = ref('')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const deleteTarget = ref<Kelas | null>(null)
const deleteWarning = ref('')

const naikkanTarget = ref<Kelas | null>(null)
const naikkanSubmitting = ref(false)
const naikkanError = ref('')
const naikkanResult = ref('')
const naikkanForm = reactive<{ mode: 'naik' | 'lulus'; target_kelas_id: string }>({ mode: 'naik', target_kelas_id: '' })

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

function openCreate() {
  error.value = ''
  resetForm()
  modalOpen.value = true
}

function openEdit(k: Kelas) {
  error.value = ''
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
      await mutation.update(editingId.value, payload)
    } else {
      await mutation.create(payload)
    }
    modalOpen.value = false
    resetForm()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menyimpan kelas'
  } finally {
    submitting.value = false
  }
}

function confirmDelete(k: Kelas) {
  deleteTarget.value = k
  const jumlah = jumlahSantriByKelas.value.get(k.id) ?? 0
  deleteWarning.value =
    jumlah > 0
      ? `Kelas ini memiliki ${jumlah} santri. Yakin ingin menghapus?`
      : 'Yakin ingin menghapus kelas ini?'
}

async function doDelete() {
  if (!deleteTarget.value) return
  try {
    await mutation.remove(deleteTarget.value.id)
    deleteTarget.value = null
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menghapus kelas'
  }
}

function openNaikkan(k: Kelas) {
  naikkanError.value = ''
  naikkanResult.value = ''
  naikkanForm.mode = 'naik'
  naikkanForm.target_kelas_id = ''
  naikkanTarget.value = k
}

async function submitNaikkan() {
  if (!naikkanTarget.value) return
  if (naikkanForm.mode === 'naik' && !naikkanForm.target_kelas_id) {
    naikkanError.value = 'Pilih kelas tujuan'
    return
  }
  naikkanSubmitting.value = true
  naikkanError.value = ''
  try {
    // Operasi bulk sekali-jalan, TETAP online-only (gak dimodel sebagai sync
    // mutation) — efeknya nyampe ke cache offline lewat entity santri yang
    // sudah kena update kelas_id-nya, ditarik lewat pull biasa di bawah.
    const res = await kelasService.naikkan(naikkanTarget.value.id, {
      lulus: naikkanForm.mode === 'lulus',
      target_kelas_id: naikkanForm.mode === 'naik' ? naikkanForm.target_kelas_id : undefined
    })
    naikkanResult.value = res.message || 'Berhasil diproses.'
    pullAll().catch(() => {})
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    naikkanError.value = err?.response?.data?.message || 'Gagal memproses kenaikan kelas'
  } finally {
    naikkanSubmitting.value = false
  }
}
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
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{{ jumlahSantriByKelas.get(k.id) ?? 0 }}</td>
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
                  @click="openNaikkan(k)"
                  class="mr-1 rounded-md p-1.5 text-emerald-600 transition hover:bg-emerald-50"
                  title="Naikkan Kelas"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
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
        <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</div>
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
      v-if="naikkanTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="naikkanTarget = null"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-1 text-lg font-semibold text-gray-900">Naikkan Kelas</h2>
        <p class="mb-4 text-sm text-gray-500">
          Berlaku untuk semua santri aktif di <strong>{{ naikkanTarget.nama }}</strong>
          ({{ jumlahSantriByKelas.get(naikkanTarget.id) ?? 0 }} santri). Kamar tidak ikut berubah.
        </p>
        <div v-if="naikkanError" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ naikkanError }}</div>
        <div v-if="naikkanResult" class="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{{ naikkanResult }}</div>

        <div class="mb-4 space-y-2">
          <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition hover:bg-gray-50">
            <input v-model="naikkanForm.mode" type="radio" value="naik" class="h-4 w-4 text-emerald-600" />
            <span class="text-sm font-medium text-gray-700">Naik ke kelas lain</span>
          </label>
          <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition hover:bg-gray-50">
            <input v-model="naikkanForm.mode" type="radio" value="lulus" class="h-4 w-4 text-emerald-600" />
            <span class="text-sm font-medium text-gray-700">Luluskan (status jadi Lulus)</span>
          </label>
        </div>

        <div v-if="naikkanForm.mode === 'naik'" class="mb-4">
          <label class="mb-1 block text-sm font-medium text-gray-700">Kelas Tujuan</label>
          <select
            v-model="naikkanForm.target_kelas_id"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="" disabled>Pilih kelas tujuan</option>
            <option v-for="k in list.filter((x) => x.id !== naikkanTarget?.id)" :key="k.id" :value="k.id">{{ k.nama }}</option>
          </select>
        </div>

        <div class="flex gap-3">
          <button
            type="button"
            :disabled="naikkanSubmitting"
            @click="submitNaikkan"
            class="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {{ naikkanSubmitting ? 'Memproses...' : 'Proses' }}
          </button>
          <button
            type="button"
            @click="naikkanTarget = null"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Tutup
          </button>
        </div>
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

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { jadwalKegiatanService, kelasService, kamarService } from '@/services'

interface Kelas {
  id: string
  nama: string
}

interface Kamar {
  id: string
  nama: string
  jenis_kelamin: 'L' | 'P'
}

interface JadwalKegiatan {
  id: string
  nama: string
  jenis?: string | null
  urutan: number
  kelas_id?: string | null
  kamar_id?: string | null
  kelas_nama?: string | null
  kamar_nama?: string | null
  is_active: number
}

const list = ref<JadwalKegiatan[]>([])
const kelasList = ref<Kelas[]>([])
const kamarList = ref<Kamar[]>([])
const loading = ref(false)
const error = ref('')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const deleteTarget = ref<JadwalKegiatan | null>(null)

const form = reactive({
  nama: '',
  jenis: '',
  urutan: 0,
  kelas_id: '',
  kamar_id: ''
})

function resetForm() {
  form.nama = ''
  form.jenis = ''
  form.urutan = (list.value.length ? Math.max(...list.value.map((j) => j.urutan)) : 0) + 1
  form.kelas_id = ''
  form.kamar_id = ''
  editingId.value = null
}

const sortedList = computed(() =>
  [...list.value].sort((a, b) => (b.is_active - a.is_active) || (a.urutan - b.urutan) || a.nama.localeCompare(b.nama))
)

async function fetchList() {
  loading.value = true
  error.value = ''
  try {
    list.value = await jadwalKegiatanService.list()
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Gagal memuat jadwal kegiatan'
  } finally {
    loading.value = false
  }
}

async function fetchOptions() {
  try {
    kelasList.value = (await kelasService.list()) as Kelas[]
  } catch {
    kelasList.value = []
  }
  try {
    kamarList.value = (await kamarService.list()) as Kamar[]
  } catch {
    kamarList.value = []
  }
}

function openCreate() {
  resetForm()
  modalOpen.value = true
}

function openEdit(j: JadwalKegiatan) {
  editingId.value = j.id
  form.nama = j.nama
  form.jenis = j.jenis ?? ''
  form.urutan = j.urutan
  form.kelas_id = j.kelas_id ?? ''
  form.kamar_id = j.kamar_id ?? ''
  modalOpen.value = true
}

async function submit() {
  if (!form.nama.trim()) {
    error.value = 'Nama jadwal wajib diisi'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    if (editingId.value) {
      // update: kirim null biar kelas/kamar yang dikosongkan balik jadi "Umum",
      // bukan undefined (yang artinya "jangan diubah" di backend)
      await jadwalKegiatanService.update(editingId.value, {
        nama: form.nama,
        jenis: form.jenis || null,
        urutan: form.urutan,
        kelas_id: form.kelas_id || null,
        kamar_id: form.kamar_id || null
      })
    } else {
      await jadwalKegiatanService.create({
        nama: form.nama,
        jenis: form.jenis || undefined,
        urutan: form.urutan,
        kelas_id: form.kelas_id || undefined,
        kamar_id: form.kamar_id || undefined
      })
    }
    modalOpen.value = false
    resetForm()
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || (e instanceof Error ? e.message : 'Gagal menyimpan jadwal kegiatan')
  } finally {
    submitting.value = false
  }
}

async function toggleActive(j: JadwalKegiatan) {
  try {
    await jadwalKegiatanService.update(j.id, { is_active: j.is_active ? 0 : 1 })
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal mengubah status jadwal.'
  }
}

function confirmDelete(j: JadwalKegiatan) {
  deleteTarget.value = j
}

async function doDelete() {
  if (!deleteTarget.value) return
  try {
    await jadwalKegiatanService.remove(deleteTarget.value.id)
    deleteTarget.value = null
    await fetchList()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal menghapus jadwal kegiatan'
  }
}

onMounted(() => {
  fetchList()
  fetchOptions()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Jadwal Kegiatan Rutin</h1>
        <p class="text-sm text-gray-500">
          Kegiatan harian yang berulang (sholat berjamaah, ta'lim, dst). Sekali dibuat di sini, instance-nya
          otomatis muncul setiap hari di halaman Kegiatan &amp; Absen Hari Ini — tidak perlu diinput ulang.
        </p>
      </div>
      <button
        type="button"
        @click="openCreate"
        class="inline-flex shrink-0 items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        + Tambah Jadwal
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 4" :key="i" class="h-14 animate-pulse rounded-lg bg-gray-100"></div>
    </div>

    <div
      v-else-if="sortedList.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center"
    >
      <svg class="mb-3 h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm font-medium text-gray-600">Belum ada jadwal kegiatan rutin</p>
      <p class="mt-1 text-xs text-gray-400">Tambahkan mis. Sholat Subuh Berjamaah, Ta'lim Malam, dst.</p>
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Urutan</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Nama</th>
              <th class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 sm:table-cell">Jenis</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Konteks</th>
              <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
              <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="j in sortedList" :key="j.id" class="transition hover:bg-gray-50" :class="{ 'opacity-50': !j.is_active }">
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{{ j.urutan }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ j.nama }}</td>
              <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600 sm:table-cell">{{ j.jenis || '-' }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                <span v-if="j.kelas_nama" class="mr-1 inline-flex rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{{ j.kelas_nama }}</span>
                <span v-if="j.kamar_nama" class="mr-1 inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{{ j.kamar_nama }}</span>
                <span v-if="!j.kelas_nama && !j.kamar_nama" class="text-gray-400">Umum</span>
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                <button
                  type="button"
                  @click="toggleActive(j)"
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="j.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'"
                >
                  {{ j.is_active ? 'Aktif' : 'Nonaktif' }}
                </button>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <button
                  type="button"
                  @click="openEdit(j)"
                  class="mr-1 rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  title="Edit"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  type="button"
                  @click="confirmDelete(j)"
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
          {{ editingId ? 'Edit Jadwal Kegiatan' : 'Tambah Jadwal Kegiatan' }}
        </h2>
        <form class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Nama <span class="text-red-500">*</span></label>
            <input
              v-model="form.nama"
              type="text"
              placeholder="mis. Sholat Subuh Berjamaah"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Jenis</label>
            <input
              v-model="form.jenis"
              type="text"
              placeholder="mis. Ibadah, Akademik, dll (opsional)"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Urutan dalam jadwal harian</label>
            <input
              v-model.number="form.urutan"
              type="number"
              min="0"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <p class="mt-1 text-xs text-gray-400">Angka lebih kecil muncul lebih dulu (mis. Tahajud = 1, Subuh = 2, dst).</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Kamar (opsional)</label>
            <select
              v-model="form.kamar_id"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">— Umum (semua kamar) —</option>
              <option v-for="k in kamarList" :key="k.id" :value="k.id">{{ k.nama }}</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">Kelas (opsional)</label>
            <select
              v-model="form.kelas_id"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">— Umum (semua kelas) —</option>
              <option v-for="k in kelasList" :key="k.id" :value="k.id">{{ k.nama }}</option>
            </select>
          </div>
          <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>
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
          <h3 class="text-base font-semibold text-gray-900">Hapus Jadwal Kegiatan</h3>
        </div>
        <p class="mb-4 text-sm text-gray-600">
          Yakin ingin menghapus jadwal "{{ deleteTarget.nama }}"? Instance kegiatan yang sudah tercatat di hari-hari
          sebelumnya tidak akan terhapus, tapi mulai besok tidak akan dibuat lagi otomatis.
        </p>
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

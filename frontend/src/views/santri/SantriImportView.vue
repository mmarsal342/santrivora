<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
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

interface PreviewRow {
  rowNumber: number
  raw: Record<string, string>
  errors: string[]
  payload: Record<string, unknown> | null
  result?: { status: 'created' | 'error'; error?: string }
}

const router = useRouter()

const kelasOptions = ref<Kelas[]>([])
const kamarOptions = ref<Kamar[]>([])

const csvText = ref('')
const rows = ref<PreviewRow[]>([])
const parseError = ref('')
const submitting = ref(false)
const submitError = ref('')
const submitted = ref(false)

const COLUMNS = ['nama_lengkap', 'jenis_kelamin', 'kelas', 'kamar', 'angkatan', 'tanggal_masuk', 'tanggal_lahir', 'love_language']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const validRows = computed(() => rows.value.filter((r) => r.errors.length === 0))
const errorRows = computed(() => rows.value.filter((r) => r.errors.length > 0))
const successCount = computed(() => rows.value.filter((r) => r.result?.status === 'created').length)
const failedAfterSubmitCount = computed(() => rows.value.filter((r) => r.result?.status === 'error').length)

async function loadOptions() {
  try {
    kelasOptions.value = (await kelasService.list()) as Kelas[]
  } catch {
    kelasOptions.value = []
  }
  try {
    kamarOptions.value = (await kamarService.list()) as Kamar[]
  } catch {
    kamarOptions.value = []
  }
}

function findKelasId(nama: string): string | null {
  const match = kelasOptions.value.find((k) => k.nama.trim().toLowerCase() === nama.trim().toLowerCase())
  return match ? match.id : null
}

function findKamarId(nama: string): string | null {
  const match = kamarOptions.value.find((k) => k.nama.trim().toLowerCase() === nama.trim().toLowerCase())
  return match ? match.id : null
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] || ''
  const tabCount = (firstLine.match(/\t/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length
  return tabCount > commaCount ? '\t' : ','
}

function parseCsv(text: string, delimiter: string = ','): string[][] {
  const rowsOut: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rowsOut.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rowsOut.push(row)
  }
  return rowsOut.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function parseAndPreview() {
  parseError.value = ''
  submitError.value = ''
  submitted.value = false
  rows.value = []

  const text = csvText.value.trim()
  if (!text) {
    parseError.value = 'Tempel atau unggah data CSV terlebih dahulu.'
    return
  }

  const table = parseCsv(text, detectDelimiter(text))
  if (table.length < 2) {
    parseError.value = 'CSV harus punya baris header dan minimal 1 baris data.'
    return
  }

  const header = table[0].map((h) => h.trim().toLowerCase())
  const missingCols = ['nama_lengkap', 'jenis_kelamin'].filter((c) => !header.includes(c))
  if (missingCols.length > 0) {
    parseError.value = `Kolom wajib tidak ditemukan di header: ${missingCols.join(', ')}`
    return
  }

  const dataRows = table.slice(1)
  const preview: PreviewRow[] = []

  dataRows.forEach((cells, idx) => {
    const raw: Record<string, string> = {}
    header.forEach((h, i) => { raw[h] = (cells[i] ?? '').trim() })

    const errors: string[] = []
    const payload: Record<string, unknown> = {}

    if (!raw.nama_lengkap || raw.nama_lengkap.length < 2) {
      errors.push('Nama lengkap wajib diisi (minimal 2 karakter).')
    } else {
      payload.nama_lengkap = raw.nama_lengkap
    }

    const jk = (raw.jenis_kelamin || '').toUpperCase()
    if (jk !== 'L' && jk !== 'P') {
      errors.push('Jenis kelamin harus "L" atau "P".')
    } else {
      payload.jenis_kelamin = jk
    }

    if (raw.kelas) {
      const kelasId = findKelasId(raw.kelas)
      if (!kelasId) {
        errors.push(`Kelas tidak ditemukan: "${raw.kelas}".`)
      } else {
        payload.kelas_id = kelasId
      }
    }

    if (raw.kamar) {
      const kamarId = findKamarId(raw.kamar)
      if (!kamarId) {
        errors.push(`Kamar tidak ditemukan: "${raw.kamar}".`)
      } else {
        payload.kamar_id = kamarId
      }
    }

    if (raw.angkatan) payload.angkatan = raw.angkatan

    if (raw.tanggal_masuk) {
      if (!DATE_RE.test(raw.tanggal_masuk)) {
        errors.push('Tanggal masuk harus format YYYY-MM-DD.')
      } else {
        payload.tanggal_masuk = raw.tanggal_masuk
      }
    }

    if (raw.tanggal_lahir) {
      if (!DATE_RE.test(raw.tanggal_lahir)) {
        errors.push('Tanggal lahir harus format YYYY-MM-DD.')
      } else {
        payload.tanggal_lahir = raw.tanggal_lahir
      }
    }

    if (raw.love_language) payload.love_language = raw.love_language

    preview.push({
      rowNumber: idx + 2, // +2: 1-indexed + header row
      raw,
      errors,
      payload: errors.length === 0 ? payload : null
    })
  })

  rows.value = preview
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    csvText.value = String(reader.result || '')
  }
  reader.readAsText(file)
  input.value = ''
}

function downloadTemplate() {
  const header = COLUMNS.join(',')
  const example = [
    'Ahmad Fauzi,L,,Kamar Putra 1,2024,2024-07-01,2012-03-15,Quality Time',
    'Siti Aminah,P,Kelas 1A,Kamar Putri 1,2024,2024-07-01,,'
  ].join('\n')
  const blob = new Blob([header + '\n' + example + '\n'], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'template_import_santri.csv'
  a.click()
  URL.revokeObjectURL(url)
}

async function submitImport() {
  if (validRows.value.length === 0) return
  submitting.value = true
  submitError.value = ''
  try {
    const payloadList = validRows.value.map((r) => r.payload as Record<string, unknown>)
    const res = await santriService.bulk(payloadList)
    const results = (res.results ?? []) as Array<{ row: number; status: 'created' | 'error'; error?: string }>
    results.forEach((r) => {
      const target = validRows.value[r.row]
      if (target) target.result = { status: r.status, error: r.error }
    })
    submitted.value = true
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    submitError.value = err?.response?.data?.message || 'Gagal mengimpor data santri.'
  } finally {
    submitting.value = false
  }
}

onMounted(loadOptions)
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-5">
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

    <div>
      <h1 class="text-2xl font-bold text-slate-900">Impor Santri dari CSV</h1>
      <p class="text-sm text-slate-500 mt-1">Tambahkan banyak santri sekaligus. Unduh template, isi, lalu tempel atau unggah di sini.</p>
    </div>

    <!-- Template + upload -->
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-slate-800">1. Siapkan file CSV</h2>
          <p class="text-xs text-slate-500 mt-0.5">
            Kolom wajib: <code class="rounded bg-slate-100 px-1">nama_lengkap</code>, <code class="rounded bg-slate-100 px-1">jenis_kelamin</code> (L/P).
            Opsional: kelas, kamar (isi dengan nama persis seperti di sistem), angkatan, tanggal_masuk, tanggal_lahir, love_language (format tanggal: YYYY-MM-DD).
          </p>
        </div>
        <button
          type="button"
          @click="downloadTemplate"
          class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Unduh Template CSV
        </button>
      </div>

      <div>
        <label class="mb-1.5 block text-sm font-medium text-slate-700">2. Unggah file CSV (opsional)</label>
        <input
          type="file"
          accept=".csv,text/csv"
          @change="onFileChange"
          class="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100"
        />
      </div>

      <div>
        <label class="mb-1.5 block text-sm font-medium text-slate-700">…atau tempel isi CSV langsung (boleh juga hasil copy-paste dari Excel/Google Sheets)</label>
        <textarea
          v-model="csvText"
          rows="8"
          placeholder="nama_lengkap,jenis_kelamin,kelas,kamar,angkatan,tanggal_masuk,tanggal_lahir,love_language"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        ></textarea>
      </div>

      <div v-if="parseError" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{{ parseError }}</div>

      <button
        type="button"
        @click="parseAndPreview"
        class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        Pratinjau Data
      </button>
    </div>

    <!-- Preview -->
    <div v-if="rows.length" class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 class="text-sm font-semibold text-slate-800">3. Pratinjau &amp; Impor</h2>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ validRows.length }} baris valid, {{ errorRows.length }} baris error, dari {{ rows.length }} baris total.
          </p>
        </div>
        <button
          type="button"
          :disabled="submitting || validRows.length === 0 || submitted"
          @click="submitImport"
          class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {{ submitting ? 'Mengimpor...' : submitted ? 'Sudah Diimpor' : `Impor ${validRows.length} Santri` }}
        </button>
      </div>

      <div v-if="submitError" class="mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{{ submitError }}</div>

      <div v-if="submitted" class="mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        {{ successCount }}/{{ validRows.length }} santri berhasil diimpor.
        <span v-if="failedAfterSubmitCount > 0">{{ failedAfterSubmitCount }} baris gagal (lihat kolom status di bawah).</span>
      </div>

      <div class="overflow-x-auto p-5">
        <table class="min-w-full divide-y divide-slate-100 text-sm">
          <thead class="bg-slate-50">
            <tr>
              <th class="px-3 py-2 text-left font-semibold text-slate-600">#</th>
              <th class="px-3 py-2 text-left font-semibold text-slate-600">Nama</th>
              <th class="px-3 py-2 text-left font-semibold text-slate-600">JK</th>
              <th class="px-3 py-2 text-left font-semibold text-slate-600">Kelas</th>
              <th class="px-3 py-2 text-left font-semibold text-slate-600">Kamar</th>
              <th class="px-3 py-2 text-left font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-50">
            <tr v-for="r in rows" :key="r.rowNumber" :class="r.errors.length ? 'bg-rose-50/40' : ''">
              <td class="px-3 py-2 text-slate-500">{{ r.rowNumber }}</td>
              <td class="px-3 py-2 font-medium text-slate-800">{{ r.raw.nama_lengkap || '-' }}</td>
              <td class="px-3 py-2 text-slate-600">{{ r.raw.jenis_kelamin || '-' }}</td>
              <td class="px-3 py-2 text-slate-600">{{ r.raw.kelas || '-' }}</td>
              <td class="px-3 py-2 text-slate-600">{{ r.raw.kamar || '-' }}</td>
              <td class="px-3 py-2">
                <template v-if="r.result">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                    :class="r.result.status === 'created' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
                  >{{ r.result.status === 'created' ? 'Berhasil' : (r.result.error || 'Gagal') }}</span>
                </template>
                <template v-else-if="r.errors.length">
                  <span class="text-xs text-rose-600">{{ r.errors.join(' ') }}</span>
                </template>
                <span v-else class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Siap diimpor</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

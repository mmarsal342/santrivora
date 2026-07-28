<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { syncService } from '@/services'
import { db } from '@/offline/db'
import EmptyState from '@/components/EmptyState.vue'

interface ConflictRow {
  id: string
  entity_type: string
  entity_id: string
  client_version: number
  server_version: number
  client_data: string
  server_data: string
  conflict_type: string
  created_at: string
}

const ENTITY_LABELS: Record<string, string> = {
  santri: 'Santri',
  catatan_disiplin: 'Catatan Disiplin',
  absensi: 'Absensi',
  kegiatan: 'Kegiatan',
  jadwal_kegiatan: 'Jadwal Kegiatan',
  catatan_perkembangan: 'Catatan Perkembangan',
  catatan_personel: 'Catatan Personel',
  catatan_haid: 'Catatan Haid',
  perizinan_pulang: 'Perizinan Pulang'
}

function entityLabel(type: string): string {
  return ENTITY_LABELS[type] ?? type
}

const loading = ref(true)
const error = ref('')
const conflicts = ref<ConflictRow[]>([])
const resolving = reactive<Record<string, boolean>>({})
const resolveError = reactive<Record<string, string>>({})
const manualMergeOpenId = ref<string | null>(null)
const manualChoices = reactive<Record<string, 'client' | 'server'>>({})

async function load() {
  loading.value = true
  error.value = ''
  try {
    conflicts.value = await syncService.listConflicts()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat daftar konflik.'
  } finally {
    loading.value = false
  }
}

function parsedClient(c: ConflictRow): Record<string, unknown> {
  try { return JSON.parse(c.client_data) } catch { return {} }
}
function parsedServer(c: ConflictRow): Record<string, unknown> {
  try { return JSON.parse(c.server_data) } catch { return {} }
}

// Kolom metadata ini SELALU "beda" (client_data cuma berisi field yang
// benar-benar dikirim user, server_data hasil SELECT * penuh) tapi bukan
// sesuatu yang user perlu pilih — disembunyikan dari diff biar gak
// menuh-menuhin tabel dengan baris yang gak relevan buat keputusan resolve.
const METADATA_FIELDS = new Set(['id', 'version', 'created_at', 'updated_at'])

function diffFields(c: ConflictRow): string[] {
  const client = parsedClient(c)
  const server = parsedServer(c)
  const keys = new Set([...Object.keys(client), ...Object.keys(server)])
  return Array.from(keys).filter((k) => !METADATA_FIELDS.has(k) && JSON.stringify(client[k]) !== JSON.stringify(server[k]))
}

/** Buang entry ini dari badge lokal (offline.conflicts) — cocok lewat
 * entityType+localId, yang SAMA dengan entity_type+entity_id server karena
 * id-nya memang identik sejak dibuat (lihat catatan di useEntityMutation). */
async function clearLocalBadge(c: ConflictRow) {
  const local = await db.conflicts.where({ entityType: c.entity_type, localId: c.entity_id }).first()
  if (local?.id !== undefined) await db.conflicts.delete(local.id)
}

async function resolve(c: ConflictRow, resolution: 'use_server' | 'use_client' | 'manual_merge', mergedData?: Record<string, unknown>) {
  resolving[c.id] = true
  resolveError[c.id] = ''
  try {
    await syncService.resolveConflict(c.id, { resolution, merged_data: mergedData })
    conflicts.value = conflicts.value.filter((x) => x.id !== c.id)
    await clearLocalBadge(c)
    if (manualMergeOpenId.value === c.id) manualMergeOpenId.value = null
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    resolveError[c.id] = err?.response?.data?.message || 'Gagal me-resolve konflik ini.'
  } finally {
    resolving[c.id] = false
  }
}

function openManualMerge(c: ConflictRow) {
  manualMergeOpenId.value = c.id
  for (const field of diffFields(c)) {
    manualChoices[`${c.id}:${field}`] = 'server'
  }
}

function submitManualMerge(c: ConflictRow) {
  const client = parsedClient(c)
  const server = parsedServer(c)
  const merged: Record<string, unknown> = {}
  for (const field of diffFields(c)) {
    const choice = manualChoices[`${c.id}:${field}`] ?? 'server'
    merged[field] = choice === 'client' ? client[field] : server[field]
  }
  resolve(c, 'manual_merge', merged)
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Konflik Sinkronisasi</h1>
      <p class="mt-1 text-sm text-slate-500">
        Data yang diubah offline dan ternyata sudah diubah orang lain lebih dulu di server. Pilih versi mana yang dipakai —
        kerjaan lain tetap jalan normal selagi ini belum diresolusi.
      </p>
    </div>

    <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ error }}</div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-24 animate-pulse rounded-xl bg-slate-100"></div>
    </div>

    <EmptyState
      v-else-if="!conflicts.length"
      title="Tidak ada konflik"
      description="Semua perubahan offline sudah tersinkron tanpa benturan."
    />

    <div v-else class="space-y-4">
      <div v-for="c in conflicts" :key="c.id" class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{{ entityLabel(c.entity_type) }}</span>
            <span class="ml-2 text-xs text-slate-400">v{{ c.client_version }} (Anda) vs v{{ c.server_version }} (server)</span>
          </div>
          <span class="text-xs text-slate-400">{{ new Date(c.created_at).toLocaleString('id-ID') }}</span>
        </div>

        <div v-if="resolveError[c.id]" class="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
          {{ resolveError[c.id] }}
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th class="py-1.5 pr-4">Field</th>
                <th class="py-1.5 pr-4">Punya Anda</th>
                <th class="py-1.5">Punya Server</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-50">
              <tr v-for="field in diffFields(c)" :key="field">
                <td class="py-1.5 pr-4 font-medium text-slate-600">{{ field }}</td>
                <td class="py-1.5 pr-4 text-slate-700">{{ parsedClient(c)[field] ?? '-' }}</td>
                <td class="py-1.5 text-slate-700">{{ parsedServer(c)[field] ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="manualMergeOpenId === c.id" class="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div v-for="field in diffFields(c)" :key="field" class="flex flex-wrap items-center gap-3 text-sm">
            <span class="w-32 shrink-0 font-medium text-slate-600">{{ field }}</span>
            <label class="flex items-center gap-1.5">
              <input type="radio" :name="`${c.id}-${field}`" :value="'client'" v-model="manualChoices[`${c.id}:${field}`]" />
              Punya Anda: {{ parsedClient(c)[field] ?? '-' }}
            </label>
            <label class="flex items-center gap-1.5">
              <input type="radio" :name="`${c.id}-${field}`" :value="'server'" v-model="manualChoices[`${c.id}:${field}`]" />
              Punya Server: {{ parsedServer(c)[field] ?? '-' }}
            </label>
          </div>
          <div class="flex gap-2 pt-1">
            <button
              type="button"
              :disabled="resolving[c.id]"
              class="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              @click="submitManualMerge(c)"
            >Simpan Gabungan</button>
            <button
              type="button"
              class="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              @click="manualMergeOpenId = null"
            >Batal</button>
          </div>
        </div>

        <div v-else class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            :disabled="resolving[c.id]"
            class="rounded-lg bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            @click="resolve(c, 'use_server')"
          >Pakai Server</button>
          <button
            type="button"
            :disabled="resolving[c.id]"
            class="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            @click="resolve(c, 'use_client')"
          >Pakai Punya Saya</button>
          <button
            type="button"
            :disabled="resolving[c.id]"
            class="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            @click="openManualMerge(c)"
          >Gabung Manual</button>
        </div>
      </div>
    </div>
  </div>
</template>

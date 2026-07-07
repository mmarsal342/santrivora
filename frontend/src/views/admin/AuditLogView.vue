<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminService } from '@/services'

interface AuditLogRow {
  id: string
  user_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  old_value: string | null
  new_value: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
  user_name: string | null
}

interface Pagination {
  page: number
  limit: number
  total: number
  total_pages: number
}

const logs = ref<AuditLogRow[]>([])
const pagination = ref<Pagination>({ page: 1, limit: 20, total: 0, total_pages: 1 })
const loading = ref(true)
const error = ref('')
const expandedIds = ref<Set<string>>(new Set())

const LIMIT = 20

async function loadLogs(page = 1) {
  loading.value = true
  error.value = ''
  try {
    const res = await adminService.getAuditLog(page, LIMIT)
    logs.value = res.data
    pagination.value = res.pagination
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } } }
    error.value = err?.response?.data?.message || 'Gagal memuat log aktivitas.'
  } finally {
    loading.value = false
  }
}

function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function goToPage(page: number) {
  if (page < 1 || page > pagination.value.total_pages || page === pagination.value.page) return
  loadLogs(page)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

function truncateId(id: string | null): string {
  if (!id) return '—'
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

function actionBadgeClass(action: string): string {
  const verb = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action
  if (verb.startsWith('create')) return 'bg-emerald-50 text-emerald-700'
  if (verb.startsWith('update')) return 'bg-amber-50 text-amber-700'
  if (verb.startsWith('delete')) return 'bg-rose-50 text-rose-700'
  if (verb.startsWith('approve')) return 'bg-sky-50 text-sky-700'
  return 'bg-slate-100 text-slate-600'
}

function prettyValue(raw: string | null): string {
  if (!raw) return '—'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

onMounted(() => {
  loadLogs(1)
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Log Aktivitas</h1>
      <p class="text-sm text-slate-500 mt-1">Riwayat aksi yang dilakukan pengguna di sistem</p>
    </div>

    <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      {{ error }}
    </div>

    <div v-if="loading && !logs.length" class="space-y-2">
      <div v-for="i in 6" :key="i" class="h-12 animate-pulse rounded-lg bg-slate-100"></div>
    </div>

    <div
      v-else-if="!logs.length"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center"
    >
      <svg class="mb-3 h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
      </svg>
      <p class="text-sm font-medium text-slate-600">Belum ada log aktivitas</p>
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-100 text-sm">
          <thead class="bg-slate-50">
            <tr>
              <th class="px-4 py-3 text-left font-semibold text-slate-600">Waktu</th>
              <th class="px-4 py-3 text-left font-semibold text-slate-600">User</th>
              <th class="px-4 py-3 text-left font-semibold text-slate-600">Action</th>
              <th class="px-4 py-3 text-left font-semibold text-slate-600">Entity</th>
              <th class="px-4 py-3 text-right font-semibold text-slate-600"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-50">
            <template v-for="log in logs" :key="log.id">
              <tr class="cursor-pointer hover:bg-slate-50/60" @click="toggleExpand(log.id)">
                <td class="whitespace-nowrap px-4 py-3 text-slate-600">{{ formatDate(log.created_at) }}</td>
                <td class="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{{ log.user_name || '—' }}</td>
                <td class="whitespace-nowrap px-4 py-3">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    :class="actionBadgeClass(log.action)"
                  >{{ log.action }}</span>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-slate-600">
                  <span class="text-slate-800">{{ log.entity_type || '—' }}</span>
                  <span v-if="log.entity_id" class="ml-1 text-xs text-slate-400">#{{ truncateId(log.entity_id) }}</span>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-right">
                  <svg
                    class="ml-auto h-4 w-4 text-slate-400 transition"
                    :class="{ 'rotate-180': expandedIds.has(log.id) }"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </td>
              </tr>
              <tr v-if="expandedIds.has(log.id)" class="bg-slate-50/60">
                <td colspan="5" class="px-4 py-4">
                  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Nilai Lama</p>
                      <pre class="max-h-64 overflow-auto rounded-lg bg-slate-100 p-3 text-xs font-mono text-slate-700">{{ prettyValue(log.old_value) }}</pre>
                    </div>
                    <div>
                      <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Nilai Baru</p>
                      <pre class="max-h-64 overflow-auto rounded-lg bg-slate-100 p-3 text-xs font-mono text-slate-700">{{ prettyValue(log.new_value) }}</pre>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                    <span>IP: {{ log.ip_address || '—' }}</span>
                    <span class="truncate">User Agent: {{ log.user_agent || '—' }}</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between border-t border-slate-100 px-4 py-3">
        <button
          type="button"
          :disabled="pagination.page <= 1 || loading"
          @click="goToPage(pagination.page - 1)"
          class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >Sebelumnya</button>
        <span class="text-xs text-slate-500">Halaman {{ pagination.page }} dari {{ pagination.total_pages || 1 }}</span>
        <button
          type="button"
          :disabled="pagination.page >= pagination.total_pages || loading"
          @click="goToPage(pagination.page + 1)"
          class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >Berikutnya</button>
      </div>
    </div>
  </div>
</template>

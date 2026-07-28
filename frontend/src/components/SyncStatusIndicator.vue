<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useSyncStatus } from '@/offline/composables/useSyncStatus'

const router = useRouter()
const { isOnline, pendingCount, errorCount, conflictCount, lastSyncAt, syncing, syncNow } = useSyncStatus()

// Re-render label waktu tiap 30 detik (bukan sekadar sekali dihitung saat
// mount) — biar "5 menit lalu" gak nyangkut lama tanpa ke-update.
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tick = setInterval(() => { now.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => {
  if (tick) clearInterval(tick)
})

const lastSyncLabel = computed(() => {
  if (!lastSyncAt.value) return 'Belum pernah sync'
  const diffMs = now.value - new Date(lastSyncAt.value).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'Baru saja'
  if (diffMin < 60) return `${diffMin} menit lalu`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} jam lalu`
  return `${Math.floor(diffHour / 24)} hari lalu`
})
</script>

<template>
  <div class="hidden items-center gap-2 text-xs text-slate-500 md:flex">
    <span class="flex items-center gap-1.5" :title="isOnline ? 'Online' : 'Offline'">
      <span class="h-2 w-2 rounded-full" :class="isOnline ? 'bg-emerald-500' : 'bg-slate-400'"></span>
      {{ isOnline ? 'Online' : 'Offline' }}
    </span>

    <span v-if="pendingCount > 0" class="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600" title="Perubahan menunggu disinkronkan">
      {{ pendingCount }} pending
    </span>
    <span v-if="errorCount > 0" class="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700" title="Gagal sync, akan dicoba lagi otomatis">
      {{ errorCount }} gagal
    </span>

    <button
      v-if="conflictCount > 0"
      type="button"
      class="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700 transition hover:bg-rose-200"
      title="Ada konflik yang perlu diresolusi"
      @click="router.push({ name: 'sync-conflicts' })"
    >
      {{ conflictCount }} konflik
    </button>

    <span class="text-slate-400">{{ lastSyncLabel }}</span>

    <button
      type="button"
      :disabled="syncing"
      class="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
      title="Sinkron sekarang"
      @click="syncNow"
    >
      <svg class="h-4 w-4" :class="{ 'animate-spin': syncing }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  actionLabel?: string
}>()

defineEmits<{
  (e: 'action'): void
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-xs">
    <div class="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400 mb-4 ring-8 ring-slate-50/50">
      <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.008 1.24l.885 1.77a2.25 2.25 0 002.007 1.24h1.98a2.25 2.25 0 002.007-1.24l.885-1.77a2.25 2.25 0 012.007-1.24h3.86m-18 0h18" />
      </svg>
    </div>
    <h3 class="text-sm font-semibold text-slate-800">{{ title }}</h3>
    <p v-if="description" class="mt-1 text-xs text-slate-500 max-w-sm">{{ description }}</p>
    <div v-if="actionLabel" class="mt-4">
      <button
        type="button"
        @click="$emit('action')"
        class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      >
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>

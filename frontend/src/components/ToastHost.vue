<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { messages, dismiss } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
    <div
      v-for="m in messages"
      :key="m.id"
      class="pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-md"
      :class="m.variant === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-white text-slate-700'"
    >
      <span>{{ m.text }}</span>
      <button type="button" class="text-xs font-medium text-slate-400 hover:text-slate-600" @click="dismiss(m.id)">
        Tutup
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

interface NavItem {
  name: string
  label: string
  to: string
  icon: readonly string[]
  adminOnly?: boolean
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const sidebarOpen = ref(false)

const navItems: readonly NavItem[] = [
  {
    name: 'dashboard',
    label: 'Dashboard',
    to: '/',
    icon: ['M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.5c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75V15a.75.75 0 01.75-.75h3a.75.75 0 01.75.75v5.25c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75V9.75M8.25 21h8.25']
  },
  {
    name: 'santri',
    label: 'Data Santri',
    to: '/santri',
    icon: ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z']
  },
  {
    name: 'catatan',
    label: 'Catatan Disiplin',
    to: '/catatan',
    icon: ['M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z']
  },
  {
    name: 'kelas',
    label: 'Manajemen Kelas',
    to: '/kelas',
    adminOnly: true,
    icon: ['M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5']
  },
  {
    name: 'kategori',
    label: 'Kategori Pelanggaran',
    to: '/kategori',
    adminOnly: true,
    icon: ['M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z', 'M6 6h.008v.008H6V6z']
  },
  {
    name: 'users',
    label: 'Manajemen User',
    to: '/users',
    adminOnly: true,
    icon: ['M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z']
  },
  {
    name: 'settings',
    label: 'Pengaturan',
    to: '/settings',
    icon: ['M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.241.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z']
  }
]

const visibleNavItems = computed<readonly NavItem[]>(() =>
  navItems.filter((item) => !item.adminOnly || auth.isAdmin)
)

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(to + '/')
}

function closeSidebar(): void {
  sidebarOpen.value = false
}

async function handleLogout(): Promise<void> {
  auth.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <!-- Mobile backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm lg:hidden"
        aria-hidden="true"
        @click="closeSidebar"
      ></div>
    </Transition>

    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-gradient-to-b from-emerald-800 to-emerald-900 text-emerald-50 shadow-xl transition-transform duration-300 ease-in-out lg:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <!-- Brand -->
      <div class="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
          <svg class="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2.25l8.25 4.125v6.375c0 4.5-3.375 7.875-8.25 9.375C7.125 20.625 3.75 17.25 3.75 12.75V6.375L12 2.25z" />
            <path d="M9 11.25l2.25 2.25L15 9.75" />
          </svg>
        </div>
        <div class="leading-tight">
          <p class="text-sm font-bold tracking-tight text-white">SantriVora</p>
          <p class="text-xs text-emerald-200/70">Pesantren Digital</p>
        </div>
        <button
          type="button"
          class="ml-auto rounded-md p-1.5 text-emerald-100 transition hover:bg-white/10 lg:hidden"
          aria-label="Tutup menu"
          @click="closeSidebar"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Nav -->
      <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <RouterLink
          v-for="item in visibleNavItems"
          :key="item.name"
          :to="item.to"
          class="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition"
          :class="
            isActive(item.to)
              ? 'bg-white/15 text-white shadow-sm ring-1 ring-white/10'
              : 'text-emerald-100/80 hover:bg-white/10 hover:text-white'
          "
          @click="closeSidebar"
        >
          <svg
            class="h-5 w-5 shrink-0 transition"
            :class="isActive(item.to) ? 'text-white' : 'text-emerald-200/70 group-hover:text-white'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path v-for="(d, i) in item.icon" :key="i" :d="d" />
          </svg>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- Sidebar footer: user info -->
      <div v-if="auth.user" class="border-t border-white/10 p-3">
        <div class="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
            {{ auth.user.nama_lengkap.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-white">{{ auth.user.nama_lengkap }}</p>
            <span
              class="mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
              :class="auth.isAdmin ? 'bg-amber-100 text-amber-700' : 'bg-emerald-200/30 text-emerald-100'"
            >
              {{ auth.isAdmin ? 'Administrator' : 'Ustadz' }}
            </span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Content area -->
    <div class="flex min-h-screen flex-col lg:pl-64">
      <!-- Topbar -->
      <header class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 shadow-sm backdrop-blur sm:px-6">
        <button
          type="button"
          class="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 lg:hidden"
          aria-label="Buka menu"
          @click="sidebarOpen = true"
        >
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        <div class="hidden flex-col sm:flex">
          <p class="text-sm font-semibold text-slate-800">{{ $route.meta.title || 'SantriVora' }}</p>
          <p class="text-xs text-slate-400">Sistem Manajemen Disiplin Santri</p>
        </div>

        <div class="ml-auto flex items-center gap-3">
          <!-- User info -->
          <div v-if="auth.user" class="hidden items-center gap-2.5 sm:flex">
            <div class="text-right leading-tight">
              <p class="text-sm font-medium text-slate-800">{{ auth.user.nama_lengkap }}</p>
              <span
                class="text-xs font-medium"
                :class="auth.isAdmin ? 'text-amber-600' : 'text-emerald-600'"
              >
                {{ auth.isAdmin ? 'Administrator' : 'Ustadz' }}
              </span>
            </div>
            <div class="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
              {{ auth.user.nama_lengkap.charAt(0).toUpperCase() }}
            </div>
          </div>

          <!-- Role badge (mobile) -->
          <span
            v-if="auth.user"
            class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium sm:hidden"
            :class="auth.isAdmin ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'"
          >
            {{ auth.isAdmin ? 'Admin' : 'Ustadz' }}
          </span>

          <!-- Logout -->
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            @click="handleLogout"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            <span class="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>

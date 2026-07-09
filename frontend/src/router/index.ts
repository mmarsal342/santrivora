import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { public: true }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/auth/RegisterView.vue'),
      meta: { public: true }
    },
    {
      path: '/',
      component: () => import('@/views/layouts/MainLayout.vue'),
      meta: { auth: true },
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue')
        },
        {
          path: 'absensi',
          name: 'absensi',
          component: () => import('@/views/absensi/AbsensiHarianView.vue')
        },
        {
          path: 'santri',
          name: 'santri',
          component: () => import('@/views/santri/SantriListView.vue')
        },
        {
          path: 'santri/:id',
          name: 'santri-detail',
          component: () => import('@/views/santri/SantriDetailView.vue')
        },
        {
          path: 'santri/new',
          name: 'santri-new',
          component: () => import('@/views/santri/SantriFormView.vue'),
          meta: { excludeReadOnly: true }
        },
        {
          path: 'santri/import',
          name: 'santri-import',
          component: () => import('@/views/santri/SantriImportView.vue'),
          meta: { excludeReadOnly: true }
        },
        {
          path: 'santri/:id/edit',
          name: 'santri-edit',
          component: () => import('@/views/santri/SantriFormView.vue'),
          meta: { excludeReadOnly: true }
        },
        {
          path: 'catatan',
          name: 'catatan',
          component: () => import('@/views/catatan/CatatanListView.vue')
        },
        {
          path: 'catatan/new',
          name: 'catatan-new',
          component: () => import('@/views/catatan/CatatanFormView.vue'),
          meta: { excludeReadOnly: true }
        },
        {
          path: 'kelas',
          name: 'kelas',
          component: () => import('@/views/kelas/KelasListView.vue'),
          meta: { adminOnly: true }
        },
        {
          path: 'kamar',
          name: 'kamar',
          component: () => import('@/views/kamar/KamarListView.vue'),
          meta: { managerOnly: true }
        },
        {
          path: 'kegiatan',
          name: 'kegiatan',
          component: () => import('@/views/kegiatan/KegiatanListView.vue')
        },
        {
          path: 'jadwal-kegiatan',
          name: 'jadwal-kegiatan',
          component: () => import('@/views/kegiatan/JadwalKegiatanListView.vue'),
          meta: { adminOnly: true }
        },
        {
          path: 'kategori',
          name: 'kategori',
          component: () => import('@/views/kategori/KategoriListView.vue'),
          meta: { adminOnly: true }
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('@/views/users/UsersListView.vue'),
          meta: { managerOnly: true }
        },
        {
          path: 'pesan',
          name: 'pesan',
          component: () => import('@/views/pesan/PesanView.vue')
        },
        {
          path: 'pesan/compose',
          name: 'pesan-compose',
          component: () => import('@/views/pesan/PesanView.vue'),
          meta: { kyaiOrAdmin: true }
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue')
        },
        {
          path: 'audit-log',
          name: 'audit-log',
          component: () => import('@/views/admin/AuditLogView.vue'),
          meta: { adminOnly: true }
        }
      ]
    }
  ]
})

router.beforeEach(async (to, _from, next) => {
  const auth = useAuthStore()

  if (to.meta.public) {
    if (auth.isAuthenticated && (to.name === 'login' || to.name === 'register')) {
      return next({ name: 'dashboard' })
    }
    return next()
  }

  if (to.meta.auth && !auth.isAuthenticated) {
    return next({ name: 'login' })
  }

  if (auth.isAuthenticated && !auth.user) {
    await auth.fetchMe()
    // If fetchMe failed (e.g. token expired + refresh failed), redirect to login
    if (!auth.isAuthenticated || !auth.user) {
      return next({ name: 'login' })
    }
  }

  const role = auth.user?.role
  // admin-only routes (kelas, kategori, audit-log, jadwal-kegiatan)
  if (to.meta.adminOnly && role !== 'admin') {
    return next({ name: 'dashboard' })
  }
  // manager-only routes: admin atau kepala_asrama (kamar, users)
  if (to.meta.managerOnly && role !== 'admin' && role !== 'kepala_asrama') {
    return next({ name: 'dashboard' })
  }
  // tolak kyai (read-only) dari halaman mutasi data
  if (to.meta.excludeReadOnly && auth.isReadOnly) {
    return next({ name: 'dashboard' })
  }
  // pesan compose: kyai atau admin
  if (to.meta.kyaiOrAdmin && role !== 'kyai' && role !== 'admin') {
    return next({ name: 'pesan' })
  }

  next()
})

export default router
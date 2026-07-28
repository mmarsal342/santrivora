import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'

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
          component: () => import('@/views/absensi/AbsensiHarianView.vue'),
          meta: { excludeReadOnly: true }
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
          component: () => import('@/views/kegiatan/KegiatanListView.vue'),
          meta: { excludeReadOnly: true }
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
          path: 'perizinan',
          name: 'perizinan',
          component: () => import('@/views/perizinan/PerizinanListView.vue')
        },
        {
          path: 'personel',
          name: 'personel',
          component: () => import('@/views/personel/PersonelListView.vue'),
          meta: { personelOnly: true }
        },
        {
          path: 'personel/:id',
          name: 'personel-detail',
          component: () => import('@/views/personel/PersonelDetailView.vue'),
          meta: { personelOnly: true }
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

type GateAwareRoute = { meta: Record<string, unknown> }
type AuthStore = ReturnType<typeof useAuthStore>

// Satu fungsi gate dipakai DUA tempat: pengecekan normal di beforeEach, DAN
// re-cek rute yang lagi dibuka pas rekonsiliasi background nemu scope yang
// berubah (lihat di bawah) — biar aturannya gak bisa ke-drift beda antara dua
// pemakaian itu.
function resolveGateRedirect(to: GateAwareRoute, auth: AuthStore): string | null {
  const role = auth.user?.role
  // admin-only routes (kelas, kategori, audit-log, jadwal-kegiatan)
  if (to.meta.adminOnly && role !== 'admin') return 'dashboard'
  // manager-only routes: admin atau kepala_asrama (kamar, users)
  if (to.meta.managerOnly && role !== 'admin' && role !== 'kepala_asrama') return 'dashboard'
  // tolak kyai (read-only) dari halaman mutasi data
  if (to.meta.excludeReadOnly && auth.isReadOnly) return 'dashboard'
  // pesan compose: kyai atau admin
  if (to.meta.kyaiOrAdmin && role !== 'kyai' && role !== 'admin') return 'pesan'
  // profil personel: kyai atau admin
  if (to.meta.personelOnly && role !== 'kyai' && role !== 'admin') return 'dashboard'
  return null
}

// Rekonsiliasi identitas dari cache cuma perlu jalan SEKALI per app-load, bukan
// tiap navigasi — kalau tidak, tiap klik menu bakal nembak fetchMe() ulang.
let hasReconciledCachedUser = false

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
    // SATU-SATUNYA kasus blocking: token ada tapi belum ada identitas ter-cache
    // sama sekali (device baru pertama kali) — gak ada apa pun buat dirender
    // instan, jadi wajib nunggu network.
    await auth.fetchMe()
    if (!auth.isAuthenticated || !auth.user) {
      return next({ name: 'login' })
    }
    hasReconciledCachedUser = true
  } else if (auth.isAuthenticated && auth.user && !hasReconciledCachedUser) {
    // Shell app render INSTAN dari identitas ter-cache (lihat stores/auth.ts) —
    // rekonsiliasi jalan di background, TIDAK nge-block navigasi ini sama
    // sekali. Kalau gagal karena offline, sesi ter-cache tetap dipakai apa
    // adanya (lihat fetchMe({background:true})).
    hasReconciledCachedUser = true
    const prevRole = auth.user.role
    const prevKelas = JSON.stringify(auth.user.kelas_ids)
    const prevKamar = JSON.stringify(auth.user.kamar_ids)
    auth.fetchMe({ background: true }).then(() => {
      if (!auth.user) return
      const scopeChanged =
        auth.user.role !== prevRole ||
        JSON.stringify(auth.user.kelas_ids) !== prevKelas ||
        JSON.stringify(auth.user.kamar_ids) !== prevKamar
      if (!scopeChanged) return
      // Mutasi yang KADUNG diantri offline dari scope lama TIDAK dihapus
      // proaktif dari outbox di sini — server sudah nge-enforce scope saat
      // push, jadi biarkan ditolak otoritatif di sana kalau memang sudah gak
      // valid, bukan di-preemptive-filter di client demi keamanan.
      const redirectTo = resolveGateRedirect(to, auth)
      if (redirectTo) router.replace({ name: redirectTo })
      useToast().show('Akses kamu baru saja diperbarui — beberapa halaman mungkin berubah.', 'warning')
    }).catch(() => {})
  }

  const redirectTo = resolveGateRedirect(to, auth)
  if (redirectTo) {
    return next({ name: redirectTo })
  }

  next()
})

export default router
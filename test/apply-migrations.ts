import { applyD1Migrations, env } from 'cloudflare:test'

// Jalan sekali sebelum semua test file (singleWorker: true di vitest.config.ts).
// isolatedStorage bawaan vitest-pool-workers ngerollback tulisan tiap test,
// jadi migration di sini cukup sekali dan tetap kepakai di semua test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

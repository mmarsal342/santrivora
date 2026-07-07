import path from 'node:path'
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(process.cwd(), 'src/db/migrations')
  const migrations = await readD1Migrations(migrationsPath)

  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            compatibilityDate: '2024-04-01',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: ['DB'],
            kvNamespaces: ['KV'],
            bindings: {
              TEST_MIGRATIONS: migrations,
              JWT_ACCESS_SECRET: 'test-access-secret',
              JWT_REFRESH_SECRET: 'test-refresh-secret',
              ENVIRONMENT: 'development'
            }
          }
        }
      }
    }
  }
})

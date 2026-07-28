// Registry generik entity offline-first — mirror src/lib/sync/registry.ts di
// backend. Nambah entity baru ke sistem sync = nambah 1 file
// entities/<nama>.config.ts (panggil registerEntity() di dalamnya) + 1 baris
// import di entities/index.ts. Tidak ada kode Dexie/composable baru yang perlu
// ditulis per entity — db.ts membangun schema dari registry ini secara
// otomatis, dan composable generik (useEntityList/useEntityMutation/dst,
// dibangun di fase POC) membaca EntityConfig ini di runtime lewat entityType.

export type EntityEligibility =
  // Bisa dibuat/diedit/dihapus offline lewat outbox + /api/sync push.
  | 'push-eligible'
  // Cuma ditarik buat cache baca (label/dropdown/lookup) — tulis tetap lewat
  // REST endpoint admin biasa yang butuh online (mirror capability:'pull-only'
  // di backend, mis. kelas/kamar/kategori_pelanggaran).
  | 'pull-only'
  // Sama sekali gak masuk sistem offline (dashboard, pesan, audit-log, dst) —
  // service dipanggil langsung seperti sebelumnya, gak lewat cache Dexie.
  | 'excluded'

export interface EntityService<T = unknown> {
  list: (params?: unknown) => Promise<unknown>
  get?: (id: string) => Promise<T>
  create?: (data: Record<string, unknown>) => Promise<T>
  update?: (id: string, data: Record<string, unknown>) => Promise<T>
  remove?: (id: string) => Promise<void>
}

export interface EntityConfig<T = unknown> {
  /** Sama dengan entityType backend (src/lib/sync/entities/*.ts) — dipakai sebagai
   * nama tabel Dexie dan sebagai `entity_type` di push item/pull changes. */
  entityType: string
  /** Skema index Dexie utk tabel ini, format string bawaan Dexie, contoh:
   * '&id, kelas_id, kamar_id, updated_at' (& = primary key unik). */
  dexieSchema: string
  eligibility: EntityEligibility
  /**
   * Dipakai HANYA oleh entity 'pull-only' — useEntityMutation menulis lewat
   * service REST ini langsung (butuh online), bukan lewat outbox, karena
   * entity ini gak push-eligible. Entity 'push-eligible' gak perlu isi field
   * ini sama sekali (create/update/remove-nya lewat outbox + /api/sync,
   * bukan manggil service manapun).
   */
  service?: EntityService<T>
  /** Bentuk response service.list() (dipakai fallback pull-only kalau ada) —
   * 'array': response = T[] langsung. 'paginated': response = { data: T[], pagination?: {...} }. */
  responseShape?: 'array' | 'paginated'
  /**
   * Mirror EntitySyncConfig.softDelete backend — dipakai push.ts buat
   * merekonsiliasi cache lokal setelah action:'delete' sukses ke-sync:
   * entity dengan ini di-UPDATE (bukan dihapus) di cache lokal, biar tetap
   * konsisten dengan state server (soft-deleted, bukan benar-benar hilang) —
   * penting supaya filter lokal (mis. status='keluar') masih akurat tanpa
   * perlu pull ulang. Entity tanpa ini dihapus beneran dari cache lokal.
   */
  softDelete?: { column: string; setValue: unknown }
}

const registry = new Map<string, EntityConfig>()

export function registerEntity(config: EntityConfig): void {
  registry.set(config.entityType, config)
}

export function getEntityConfig(entityType: string): EntityConfig | undefined {
  return registry.get(entityType)
}

export function allEntities(): EntityConfig[] {
  return Array.from(registry.values())
}

export function pushEligibleEntities(): EntityConfig[] {
  return allEntities().filter((c) => c.eligibility === 'push-eligible')
}

/** Entity yang perlu ditarik lewat pull (push-eligible ATAU pull-only). */
export function pullableEntities(): EntityConfig[] {
  return allEntities().filter((c) => c.eligibility !== 'excluded')
}

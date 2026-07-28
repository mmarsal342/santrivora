import type { EntitySyncConfig } from './types'

const registry = new Map<string, EntitySyncConfig>()

export function registerEntity(config: EntitySyncConfig): void {
  if (registry.has(config.entityType)) {
    throw new Error(`Entity sync "${config.entityType}" sudah terdaftar`)
  }
  registry.set(config.entityType, config)
}

export function getEntityConfig(entityType: string): EntitySyncConfig | undefined {
  return registry.get(entityType)
}

export function allEntities(): EntitySyncConfig[] {
  return [...registry.values()]
}

/** Entity yang boleh menerima push (create/update/delete lewat POST /api/sync). */
export function pushEligibleEntityTypes(): string[] {
  return allEntities().filter((c) => c.capability === 'full').map((c) => c.entityType)
}

/** Entity yang ikut GET /api/sync/pull (full ATAU pull-only). */
export function pullableEntityTypes(): string[] {
  return allEntities().filter((c) => c.capability !== 'none').map((c) => c.entityType)
}

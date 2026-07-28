import { kelasService } from '@/services'
import { registerEntity, type EntityConfig } from '../registry'

// pull-only, mirror kamar (fase 19/20) — admin mengelola kelas lewat REST
// endpoint biasa (butuh online, termasuk aksi bulk kelasService.naikkan()
// yang TETAP online-only, gak dimodel sebagai sync mutation sama sekali —
// itu operasi sekali-jalan yang efeknya nyampe ke client offline lewat
// entity santri yang di-pull biasa).
export const kelasEntityConfig: EntityConfig = {
  entityType: 'kelas',
  dexieSchema: '&id, is_active, updated_at',
  eligibility: 'pull-only',
  // Mirror kelas.ts DELETE — soft-delete (is_active=0), bukan hard-delete.
  softDelete: { column: 'is_active', setValue: 0 },
  service: {
    list: () => kelasService.list(),
    get: (id) => kelasService.get(id),
    create: (data) => kelasService.create(data as { nama: string; tingkatan?: string; tahun_ajaran?: string }),
    update: (id, data) => kelasService.update(id, data),
    remove: (id) => kelasService.remove(id)
  },
  responseShape: 'array'
}

registerEntity(kelasEntityConfig)

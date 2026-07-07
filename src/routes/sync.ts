import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const sync = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

sync.use('*', authMiddleware)

const pushItemSchema = z.object({
  entity_type: z.enum(['santri', 'catatan_disiplin']),
  local_id: z.string(),
  action: z.enum(['create', 'update', 'delete']),
  data: z.record(z.string(), z.unknown()),
  version: z.number().int().min(0)
})

const pushSchema = z.object({
  items: z.array(pushItemSchema).min(1).max(100)
})

// POST /api/sync — push batch changes from client
sync.post('/', zValidator('json', pushSchema), async (c) => {
  const { items } = c.req.valid('json')
  const user = c.get('user')
  const results: Array<{
    local_id: string
    status: 'synced' | 'conflict' | 'error'
    server_id?: string
    server_version?: number
    error?: string
    conflict?: {
      type: string
      server_data: Record<string, unknown>
      server_version: number
    }
  }> = []

  for (const item of items) {
    try {
      const result = await processSyncItem(c.env, item, user)
      results.push(result)
    } catch (err: any) {
      results.push({
        local_id: item.local_id,
        status: 'error',
        error: err.message || 'Unknown error'
      })
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'sync.push', 'sync', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, user.sub, JSON.stringify({ items: items.length, success: results.filter(r => r.status === 'synced').length })).run()

  return c.json({ results })
})

// GET /api/sync/pull?since=timestamp&cursor=
sync.get('/pull', async (c) => {
  const user = c.get('user')
  const since = c.req.query('since')
  const cursor = c.req.query('cursor')
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)

  if (!since) {
    return c.json({
      error: 'Bad Request',
      code: 'MISSING_SINCE',
      message: 'Parameter "since" (ISO timestamp) wajib diisi.'
    } as ApiError, 400)
  }

  // Build santri query
  let santriQuery = 'SELECT * FROM santri WHERE updated_at > ?'
  const santriParams: unknown[] = [since]

  // Build catatan query
  let catatanQuery = `
    SELECT cd.*, kp.nama as kategori_nama
    FROM catatan_disiplin cd
    LEFT JOIN kategori_pelanggaran kp ON cd.kategori_id = kp.id
    WHERE cd.updated_at > ?
  `
  const catatanParams: unknown[] = [since]

  // Scope for ustadz — kelas assignment OR kamar assignment, sama seperti santri.ts/catatan.ts
  if (user.role === 'ustadz') {
    const scopeParts: string[] = []
    if (user.kelas_ids.length > 0) scopeParts.push(`kelas_id IN (${user.kelas_ids.map(() => '?').join(',')})`)
    if (user.kamar_ids.length > 0) scopeParts.push(`kamar_id IN (${user.kamar_ids.map(() => '?').join(',')})`)

    if (scopeParts.length === 0) {
      return c.json({ changes: { santri: [], catatan_disiplin: [] }, cursor: null, has_more: false, server_time: new Date().toISOString() })
    }
    const scope = `(${scopeParts.join(' OR ')})`

    santriQuery += ` AND ${scope}`
    santriParams.push(...user.kelas_ids, ...user.kamar_ids)

    catatanQuery += ` AND cd.santri_id IN (SELECT id FROM santri WHERE ${scope})`
    catatanParams.push(...user.kelas_ids, ...user.kamar_ids)
  }

  if (cursor) {
    santriQuery += ' AND id > ?'
    santriParams.push(cursor)
    catatanQuery += ' AND cd.id > ?'
    catatanParams.push(cursor)
  }

  santriQuery += ' ORDER BY id ASC LIMIT ?'
  catatanQuery += ' ORDER BY cd.id ASC LIMIT ?'

  const santriResult = await c.env.DB.prepare(santriQuery).bind(...santriParams, limit).all()
  const catatanResult = await c.env.DB.prepare(catatanQuery).bind(...catatanParams, limit).all()

  const santriChanges = santriResult.results || []
  const catatanChanges = catatanResult.results || []

  const totalChanges = santriChanges.length + catatanChanges.length
  const hasMore = santriChanges.length >= limit || catatanChanges.length >= limit

  const lastSantri = santriChanges[santriChanges.length - 1] as { id: string } | undefined
  const lastCatatan = catatanChanges[catatanChanges.length - 1] as { id: string } | undefined
  const nextCursor = hasMore ? (lastCatatan?.id || lastSantri?.id || null) : null

  return c.json({
    changes: {
      santri: santriChanges,
      catatan_disiplin: catatanChanges
    },
    cursor: nextCursor,
    has_more: hasMore,
    server_time: new Date().toISOString()
  })
})

// GET /api/sync/conflicts — list unresolved conflicts
sync.get('/conflicts', async (c) => {
  const user = c.get('user')

  let results: unknown[] = []
  if (user.role === 'admin') {
    const dbResult = await c.env.DB.prepare(
      "SELECT * FROM sync_conflicts WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50"
    ).all()
    results = dbResult.results || []
  } else {
    const dbResult = await c.env.DB.prepare(
      "SELECT * FROM sync_conflicts WHERE status = 'pending' AND resolved_by = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(user.sub).all()
    results = dbResult.results || []
  }

  return c.json({ data: results })
})

// POST /api/sync/conflicts/:id/resolve
sync.post('/conflicts/:id/resolve', async (c) => {
  const conflictId = c.req.param('id')
  const user = c.get('user')
  type ResolveBody = { resolution: 'use_server' | 'use_client' | 'manual_merge'; merged_data?: Record<string, unknown> }
  const body = await c.req.json<ResolveBody>().catch(() => ({ resolution: 'use_server' } as ResolveBody))

  const conflict = await c.env.DB.prepare(
    "SELECT * FROM sync_conflicts WHERE id = ? AND status = 'pending'"
  ).bind(conflictId).first<{
    id: string; entity_type: string; entity_id: string
    server_version: number; client_data: string; server_data: string
  }>()

  if (!conflict) {
    return c.json({
      error: 'Not Found',
      code: 'CONFLICT_NOT_FOUND',
      message: 'Conflict tidak ditemukan atau sudah diresolve.'
    } as ApiError, 404)
  }

  let resolvedData: Record<string, unknown> | null = null

  switch (body.resolution) {
    case 'use_server':
      resolvedData = JSON.parse(conflict.server_data)
      break
    case 'use_client':
      resolvedData = JSON.parse(conflict.client_data)
      break
    case 'manual_merge':
      if (!body.merged_data) {
        return c.json({
          error: 'Bad Request',
          code: 'MISSING_MERGED_DATA',
          message: 'Data hasil merge harus disertakan.'
        } as ApiError, 400)
      }
      resolvedData = body.merged_data
      break
  }

  if (resolvedData) {
    const updateFields = Object.entries(resolvedData)
      .filter(([k]) => !['id', 'version', 'created_at', 'updated_at'].includes(k))

    if (updateFields.length > 0 && conflict.entity_type === 'santri') {
      const sets = updateFields.map(([k]) => `${k} = ?`).join(', ')
      const vals = updateFields.map(([, v]) => v)
      await c.env.DB.prepare(
        `UPDATE santri SET ${sets}, version = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(...vals, conflict.server_version + 1, conflict.entity_id).run()
    }
  }

  await c.env.DB.prepare(
    "UPDATE sync_conflicts SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?"
  ).bind(user.sub, conflictId).run()

  return c.json({ message: 'Conflict berhasil diresolve.' })
})

// Helper: process single sync item
async function processSyncItem(
  env: Env, item: z.infer<typeof pushItemSchema>, user: UserPayload
): Promise<{
  local_id: string; status: 'synced' | 'conflict' | 'error'; server_id?: string; server_version?: number
  error?: string; conflict?: any
}> {
  switch (item.entity_type) {
    case 'santri':
      return processSantriSync(env, item, user)
    case 'catatan_disiplin':
      return processCatatanSync(env, item, user)
    default:
      return { local_id: item.local_id, status: 'error', error: 'Unknown entity type' }
  }
}

async function processSantriSync(env: Env, item: any, user: UserPayload): Promise<any> {
  const serverId = item.data.id as string | undefined

  switch (item.action) {
    case 'create': {
      if (serverId) {
        // Check for duplicate
        const existing = await env.DB.prepare("SELECT id FROM santri WHERE id = ?").bind(serverId).first()
        if (existing) {
          return { local_id: item.local_id, status: 'synced', server_id: serverId, server_version: 1 }
        }
      }

      // Scope check
      const kelasId = item.data.kelas_id as string | undefined
      if (user.role === 'ustadz' && kelasId && !user.kelas_ids.includes(kelasId)) {
        return { local_id: item.local_id, status: 'error', error: 'KELAS_NOT_ASSIGNED' }
      }

      const newId = serverId || crypto.randomUUID()
      await env.DB.prepare(
        `INSERT INTO santri (id, nama_lengkap, jenis_kelamin, kelas_id, angkatan, tanggal_masuk, foto_url, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        newId,
        item.data.nama_lengkap || '',
        item.data.jenis_kelamin || 'L',
        item.data.kelas_id || null,
        item.data.angkatan || null,
        item.data.tanggal_masuk || null,
        item.data.foto_url || null
      ).run()

      return { local_id: item.local_id, status: 'synced', server_id: newId, server_version: 1 }
    }

    case 'update': {
      if (!serverId) {
        return { local_id: item.local_id, status: 'error', error: 'Server ID required for update' }
      }

      const current = await env.DB.prepare(
        'SELECT id, version FROM santri WHERE id = ?'
      ).bind(serverId).first<{ id: string; version: number }>()

      if (!current) {
        return { local_id: item.local_id, status: 'error', error: 'Record not found on server' }
      }

      // Scope check
      const kelasId = item.data.kelas_id as string | undefined
      if (user.role === 'ustadz' && kelasId && !user.kelas_ids.includes(kelasId)) {
        return { local_id: item.local_id, status: 'error', error: 'KELAS_NOT_ASSIGNED' }
      }

      // Conflict detection
      if (current.version > item.version) {
        const serverData = await env.DB.prepare('SELECT * FROM santri WHERE id = ?').bind(serverId).first()

        await env.DB.prepare(
          `INSERT INTO sync_conflicts (id, entity_type, entity_id, client_version, server_version, client_data, server_data, conflict_type)
           VALUES (?, 'santri', ?, ?, ?, ?, ?, 'version_mismatch')`
        ).bind(
          crypto.randomUUID(), serverId, item.version, current.version,
          JSON.stringify(item.data), JSON.stringify(serverData)
        ).run()

        return {
          local_id: item.local_id,
          status: 'conflict',
          conflict: {
            type: 'version_mismatch',
            server_data: serverData as Record<string, unknown>,
            server_version: current.version
          }
        }
      }

      // Apply update
      const updateFields = ['nama_lengkap', 'jenis_kelamin', 'kelas_id', 'angkatan', 'tanggal_masuk', 'status', 'foto_url']
      const sets = updateFields.filter(f => item.data[f] !== undefined).map(f => `${f} = ?`).join(', ')
      const vals = updateFields.filter(f => item.data[f] !== undefined).map(f => item.data[f])

      if (sets) {
        await env.DB.prepare(
          `UPDATE santri SET ${sets}, version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?`
        ).bind(...vals, serverId, item.version).run()
      }

      return { local_id: item.local_id, status: 'synced', server_id: serverId, server_version: current.version + 1 }
    }

    case 'delete': {
      if (!serverId) {
        return { local_id: item.local_id, status: 'error', error: 'Server ID required for delete' }
      }

      await env.DB.prepare(
        "UPDATE santri SET status = 'keluar', version = version + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(serverId).run()

      return { local_id: item.local_id, status: 'synced', server_id: serverId }
    }
  }
}

async function processCatatanSync(env: Env, item: any, user: UserPayload): Promise<any> {
  const serverId = item.data.id as string | undefined

  switch (item.action) {
    case 'create': {
      const newId = serverId || crypto.randomUUID()
      await env.DB.prepare(
        `INSERT INTO catatan_disiplin (id, santri_id, tipe, kategori_id, judul, deskripsi, tanggal_kejadian, dicatat_oleh, tindak_lanjut, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        newId,
        item.data.santri_id || '',
        item.data.tipe || 'pelanggaran',
        item.data.kategori_id || null,
        item.data.judul || '',
        item.data.deskripsi || null,
        item.data.tanggal_kejadian || '',
        user.sub,
        item.data.tindak_lanjut || null
      ).run()

      return { local_id: item.local_id, status: 'synced', server_id: newId, server_version: 1 }
    }

    case 'update': {
      if (!serverId) {
        return { local_id: item.local_id, status: 'error', error: 'Server ID required for update' }
      }

      const current = await env.DB.prepare(
        'SELECT id, version FROM catatan_disiplin WHERE id = ? AND is_deleted = 0'
      ).bind(serverId).first<{ id: string; version: number }>()

      if (!current) {
        return { local_id: item.local_id, status: 'error', error: 'Record not found' }
      }

      if (current.version > item.version) {
        const serverData = await env.DB.prepare('SELECT * FROM catatan_disiplin WHERE id = ?').bind(serverId).first()
        return {
          local_id: item.local_id,
          status: 'conflict',
          conflict: {
            type: 'version_mismatch',
            server_data: serverData as Record<string, unknown>,
            server_version: current.version
          }
        }
      }

      const updateFields = ['kategori_id', 'judul', 'deskripsi', 'tanggal_kejadian', 'tindak_lanjut']
      const sets = updateFields.filter(f => item.data[f] !== undefined).map(f => `${f} = ?`).join(', ')
      const vals = updateFields.filter(f => item.data[f] !== undefined).map(f => item.data[f])

      if (sets) {
        await env.DB.prepare(
          `UPDATE catatan_disiplin SET ${sets}, version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?`
        ).bind(...vals, serverId, item.version).run()
      }

      return { local_id: item.local_id, status: 'synced', server_id: serverId, server_version: current.version + 1 }
    }

    case 'delete': {
      if (!serverId) return { local_id: item.local_id, status: 'error', error: 'Server ID required' }
      await env.DB.prepare(
        "UPDATE catatan_disiplin SET is_deleted = 1, version = version + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(serverId).run()
      return { local_id: item.local_id, status: 'synced', server_id: serverId }
    }
  }
}

async function getEntitiesChanges(env: Env, type: string, ids: string[]): Promise<unknown[]> {
  if (ids.length === 0) return []

  const uniqueIds = [...new Set(ids)]
  const ph = uniqueIds.map(() => '?').join(',')

  if (type === 'santri') {
    const result = await env.DB.prepare(`
      SELECT s.*, k.nama as kelas_nama
      FROM santri s
      LEFT JOIN kelas k ON s.kelas_id = k.id
      WHERE s.id IN (${ph})
    `).bind(...uniqueIds).all()
    return result.results || []
  }

  if (type === 'catatan_disiplin') {
    const result = await env.DB.prepare(`
      SELECT cd.*, kp.nama as kategori_nama
      FROM catatan_disiplin cd
      LEFT JOIN kategori_pelanggaran kp ON cd.kategori_id = kp.id
      WHERE cd.id IN (${ph})
    `).bind(...uniqueIds).all()
    return result.results || []
  }

  return []
}

export { sync as syncRoutes }
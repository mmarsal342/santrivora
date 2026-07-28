import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireCanMutate } from '../middleware/auth'
import '../lib/sync/entities'
import { pullableEntityTypes, pushEligibleEntityTypes } from '../lib/sync/registry'
import { processPull, processPushItem, processResolve } from '../lib/sync/engine'
import type { ApiError, Env, UserPayload } from '../types'

const sync = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

sync.use('*', authMiddleware)

const pushItemSchema = z.object({
  entity_type: z.string().refine((v) => pushEligibleEntityTypes().includes(v), { message: 'Unknown entity type' }),
  local_id: z.string(),
  action: z.enum(['create', 'update', 'delete']),
  data: z.record(z.string(), z.unknown()),
  version: z.number().int().min(0)
})

const pushSchema = z.object({
  items: z.array(pushItemSchema).min(1).max(100)
})

// POST /api/sync — push batch changes from client
sync.post('/', requireCanMutate(), zValidator('json', pushSchema), async (c) => {
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
      const result = await processPushItem(c.env, item, user)
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
  ).bind(crypto.randomUUID(), user.sub, user.sub, JSON.stringify({ items: items.length, success: results.filter((r) => r.status === 'synced').length })).run()

  return c.json({ results })
})

// GET /api/sync/pull?since=timestamp&cursor_santri=&cursor_catatan=
sync.get('/pull', async (c) => {
  const user = c.get('user')
  const since = c.req.query('since')
  const limit = Math.min(parseInt(c.req.query('limit') || '100') || 100, 500)

  if (!since) {
    return c.json({
      error: 'Bad Request',
      code: 'MISSING_SINCE',
      message: 'Parameter "since" (ISO timestamp) wajib diisi.'
    } as ApiError, 400)
  }

  // Cursor per-entity generik: query param `cursor_<entityType>` untuk semua
  // entity yang terdaftar di registry. `cursor_catatan` (bukan cursor_catatan_
  // disiplin) dipertahankan sebagai alias lama untuk kompatibilitas.
  const entityTypes = pullableEntityTypes()
  const cursors: Record<string, string | null> = {}
  for (const t of entityTypes) {
    cursors[t] = c.req.query(`cursor_${t}`) ?? null
  }
  if (!cursors.catatan_disiplin) {
    cursors.catatan_disiplin = c.req.query('cursor_catatan') ?? null
  }

  const result = await processPull(c.env, user, since, cursors, limit)

  const responseCursors: Record<string, string | null> = {}
  for (const t of entityTypes) {
    responseCursors[`cursor_${t}`] = result.cursors[t] ?? null
  }
  responseCursors.cursor_catatan = result.cursors.catatan_disiplin ?? null

  return c.json({
    changes: result.changes,
    ...responseCursors,
    has_more: result.has_more,
    server_time: result.server_time
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
      "SELECT * FROM sync_conflicts WHERE status = 'pending' AND user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(user.sub).all()
    results = dbResult.results || []
  }

  return c.json({ data: results })
})

// POST /api/sync/conflicts/:id/resolve
sync.post('/conflicts/:id/resolve', requireCanMutate(), async (c) => {
  const conflictId = c.req.param('id') ?? ''
  const user = c.get('user')
  type ResolveBody = { resolution: 'use_server' | 'use_client' | 'manual_merge'; merged_data?: Record<string, unknown> }
  const rawBody = await c.req.json<Partial<ResolveBody>>().catch(() => ({} as Partial<ResolveBody>))
  if (rawBody.resolution !== 'use_server' && rawBody.resolution !== 'use_client' && rawBody.resolution !== 'manual_merge') {
    return c.json({
      error: 'Bad Request',
      code: 'INVALID_RESOLUTION',
      message: 'resolution harus salah satu dari: use_server, use_client, manual_merge.'
    } as ApiError, 400)
  }
  const body = rawBody as ResolveBody

  const outcome = await processResolve(c.env, user, conflictId, body)
  return c.json(outcome.body, outcome.status as 200 | 400 | 403 | 404 | 409)
})

export { sync as syncRoutes }

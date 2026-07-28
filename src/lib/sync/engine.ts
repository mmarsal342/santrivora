import { resolveKamarScope } from '../scope'
import { checkScopeRule, checkTargetScopeRule } from './scopeDispatch'
import { getEntityConfig, pullableEntityTypes } from './registry'
import type { Env, UserPayload } from '../../types'
import type { EntitySyncConfig, PushItem, PushResult, RefValidation, ScopeRule } from './types'

// ============================================================
// Ref validation (generalisasi validateSantriRefs/validatePartialSantriRefs/
// validateKategoriRef) — lihat komentar lengkap di types.ts (RefValidation).
// ============================================================

async function validateRefsForCreate(
  env: Env, refValidations: RefValidation[] | undefined, effective: Record<string, unknown>
): Promise<string | null> {
  if (!refValidations) return null
  for (const rv of refValidations) {
    if (rv.when && !rv.when(effective)) continue
    const value = effective[rv.column]
    if (!value) continue
    const activeFilter = rv.refActiveColumn ? ` AND ${rv.refActiveColumn} = 1` : ''
    const refRow = await env.DB.prepare(`SELECT * FROM ${rv.refTable} WHERE id = ?${activeFilter}`).bind(value).first<Record<string, unknown>>()
    if (!refRow) return rv.notFoundCode
    if (rv.crossCheck) {
      const err = rv.crossCheck(refRow, effective)
      if (err) return err
    }
  }
  return null
}

async function validateRefsForUpdate(
  env: Env, refValidations: RefValidation[] | undefined, current: Record<string, unknown>, patch: Record<string, unknown>
): Promise<string | null> {
  if (!refValidations) return null
  const effective = { ...current, ...patch }
  for (const rv of refValidations) {
    if (rv.when && !rv.when(effective)) continue
    const trigger = rv.existenceTrigger ?? 'changed'
    const ownPresent = patch[rv.column] !== undefined
    const ownChanging = ownPresent && patch[rv.column] !== current[rv.column]
    const watch = rv.watchColumns ?? [rv.column]
    const anyWatchChanging = watch.some((col) => patch[col] !== undefined && patch[col] !== current[col])

    const shouldRun = trigger === 'present' ? ownPresent : anyWatchChanging
    if (!shouldRun) continue

    const effectiveValue = effective[rv.column]
    if (!effectiveValue) continue

    // Exists+active cuma dicek kalau kolom REF ITU SENDIRI berubah (trigger
    // 'changed') atau selalu (trigger 'present') — beda dari crossCheck yang
    // tetap jalan walau cuma kolom watch LAIN yang berubah (mis. jenis_kelamin
    // berubah tapi kamar_id tetap sama — kamar yang belakangan dinonaktifkan
    // tidak boleh mem-blokir edit ini, cuma gender-match-nya yang tetap dicek).
    const needsExistenceCheck = trigger === 'present' ? true : ownChanging
    const activeFilter = rv.refActiveColumn && needsExistenceCheck ? ` AND ${rv.refActiveColumn} = 1` : ''
    const refRow = await env.DB.prepare(`SELECT * FROM ${rv.refTable} WHERE id = ?${activeFilter}`).bind(effectiveValue).first<Record<string, unknown>>()
    if (needsExistenceCheck && !refRow) return rv.notFoundCode
    if (refRow && rv.crossCheck) {
      const err = rv.crossCheck(refRow, effective)
      if (err) return err
    }
  }
  return null
}

// ============================================================
// Helpers
// ============================================================

async function fetchCurrentForWrite(env: Env, config: EntitySyncConfig, id: string): Promise<Record<string, unknown> | null> {
  const idCol = config.idColumn ?? 'id'
  let query = `SELECT * FROM ${config.table} WHERE ${idCol} = ?`
  if (config.softDelete?.excludeFromFetch) {
    query += ` AND ${config.softDelete.column} != ?`
    return (await env.DB.prepare(query).bind(id, config.softDelete.setValue).first<Record<string, unknown>>()) ?? null
  }
  return (await env.DB.prepare(query).bind(id).first<Record<string, unknown>>()) ?? null
}

async function persistConflict(
  env: Env, config: EntitySyncConfig, user: UserPayload, serverId: string, item: PushItem, fallbackVersion: number
): Promise<PushResult> {
  const idCol = config.idColumn ?? 'id'
  const serverData = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE ${idCol} = ?`).bind(serverId).first<Record<string, unknown>>()
  const serverVersion = (serverData?.version as number | undefined) ?? fallbackVersion
  await env.DB.prepare(
    `INSERT INTO sync_conflicts (id, user_id, entity_type, entity_id, client_version, server_version, client_data, server_data, conflict_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'version_mismatch')`
  ).bind(
    crypto.randomUUID(), user.sub, config.entityType, serverId, item.version, serverVersion,
    JSON.stringify(item.data), JSON.stringify(serverData)
  ).run()
  return {
    local_id: item.local_id,
    status: 'conflict',
    conflict: { type: 'version_mismatch', server_data: (serverData ?? {}) as Record<string, unknown>, server_version: serverVersion }
  }
}

// ============================================================
// Push: create / update / delete
// ============================================================

async function processCreate(env: Env, config: EntitySyncConfig, item: PushItem, user: UserPayload): Promise<PushResult> {
  const parseResult = config.createSchema.safeParse(item.data)
  if (!parseResult.success) {
    return { local_id: item.local_id, status: 'error', error: 'INVALID_DATA: ' + parseResult.error.issues[0]?.message }
  }
  const data = parseResult.data as Record<string, unknown>
  const idCol = config.idColumn ?? 'id'
  const serverId = data.id as string | undefined

  if (config.idempotentCreate && serverId) {
    const existing = await env.DB.prepare(`SELECT ${idCol} FROM ${config.table} WHERE ${idCol} = ?`).bind(serverId).first()
    if (existing) {
      return { local_id: item.local_id, status: 'synced', server_id: serverId, server_version: 1 }
    }
  }

  if (config.customCreateCheck) {
    const err = await config.customCreateCheck(env, user, data)
    if (err) return { local_id: item.local_id, status: 'error', error: err }
  } else if (config.scope.kind === 'direct-kamar-kelas') {
    const targetScopeErr = await checkTargetScopeRule(env, user, config.targetScope ?? config.scope, data)
    if (targetScopeErr) return { local_id: item.local_id, status: 'error', error: targetScopeErr }
  } else if (config.scope.kind === 'via-santri') {
    const santriId = data[config.scope.santriIdColumn] as string | undefined
    if (!santriId) return { local_id: item.local_id, status: 'error', error: `${config.scope.santriIdColumn} required` }
    const santri = await env.DB.prepare('SELECT kelas_id, kamar_id, status FROM santri WHERE id = ?').bind(santriId).first<{ kelas_id: string | null; kamar_id: string | null; status: string }>()
    if (!santri) return { local_id: item.local_id, status: 'error', error: 'SANTRI_NOT_FOUND' }
    if (!(await checkScopeRule(env, user, { kind: 'direct-kamar-kelas' } as ScopeRule, santri))) {
      return { local_id: item.local_id, status: 'error', error: config.scopeDeniedCode }
    }
    if (config.requireActiveParent && santri.status !== 'aktif') {
      return { local_id: item.local_id, status: 'error', error: 'SANTRI_NOT_ACTIVE' }
    }
  } else {
    // 'custom' / 'role-only' / 'global' — entity tanpa kelas_id/kamar_id sendiri
    // dan tanpa konsep "target" (mis. absensi: akses ditentukan lewat santri_id
    // yang dituju, bukan lewat sesuatu yang sedang "dipindah").
    const rule = config.targetScope ?? config.scope
    if (!(await checkScopeRule(env, user, rule, data))) {
      return { local_id: item.local_id, status: 'error', error: config.scopeDeniedCode }
    }
  }

  const refErr = await validateRefsForCreate(env, config.refValidations, data)
  if (refErr) return { local_id: item.local_id, status: 'error', error: refErr }

  if (config.naturalKey) {
    return processNaturalKeyUpsert(env, config, item, data, user)
  }

  const newId = serverId || crypto.randomUUID()
  const createCols = config.createColumns ?? config.writableColumns
  const extra = config.createExtra ? config.createExtra(data, user) : {}
  // Kolom yang NILAINYA undefined (client tidak mengirim field itu sama sekali)
  // DIOMIT dari INSERT, bukan dipaksa NULL — supaya DEFAULT kolom di DB (mis.
  // jadwal_kegiatan.urutan DEFAULT 0, santri.status DEFAULT 'aktif') yang
  // berlaku. Field yang eksplisit dikirim `null` oleh client tetap disimpan
  // sebagai NULL (beda dari "tidak dikirim sama sekali").
  const presentCols = createCols.filter((c) => data[c] !== undefined)
  const colNames = [idCol, ...presentCols, ...Object.keys(extra), 'version']
  const values = [newId, ...presentCols.map((c) => data[c]), ...Object.values(extra), 1]
  const placeholders = colNames.map(() => '?').join(', ')
  await env.DB.prepare(`INSERT INTO ${config.table} (${colNames.join(', ')}) VALUES (${placeholders})`).bind(...values).run()

  if (config.afterWrite) {
    await config.afterWrite(env, 'create', newId, null, { ...data, ...extra, id: newId })
  }

  return { local_id: item.local_id, status: 'synced', server_id: newId, server_version: 1 }
}

/**
 * Upsert berbasis kombinasi kolom unik (bukan id) — dipakai absensi, mirror
 * semantik ON CONFLICT(...) DO UPDATE yang sudah ada di absensi.ts /bulk:
 * kalau baris dengan kombinasi naturalKey ini sudah ada, TIMPA (last-write-wins,
 * TANPA optimistic-concurrency check di jalur create — sengaja, demi paritas
 * dengan endpoint /bulk yang sudah ada), bukan bikin baris baru/duplikat.
 */
async function processNaturalKeyUpsert(
  env: Env, config: EntitySyncConfig, item: PushItem, data: Record<string, unknown>, user: UserPayload
): Promise<PushResult> {
  const idCol = config.idColumn ?? 'id'
  const keyCols = config.naturalKey!
  const conds = keyCols
    .map((k) => (config.naturalKeyNullable?.includes(k) ? `COALESCE(${k}, '') = COALESCE(?, '')` : `${k} = ?`))
    .join(' AND ')
  const keyValues = keyCols.map((k) => (data[k] !== undefined ? data[k] : null))

  const existing = await env.DB.prepare(`SELECT ${idCol} FROM ${config.table} WHERE ${conds}`).bind(...keyValues).first<Record<string, unknown>>()

  const createCols = config.createColumns ?? config.writableColumns
  const extra = config.createExtra ? config.createExtra(data, user) : {}
  // Sama seperti processCreate: kolom yang undefined DIOMIT (bukan dipaksa
  // NULL) supaya DEFAULT kolom di DB tetap berlaku kalau client tidak
  // mengirimkannya.
  const presentCols = createCols.filter((c) => data[c] !== undefined)
  const setValues = [...presentCols.map((c) => data[c]), ...Object.values(extra)]

  if (existing) {
    const targetId = existing[idCol] as string
    const setCols = [...presentCols, ...Object.keys(extra)]
    const sets = setCols.map((c) => `${c} = ?`).join(', ')
    await env.DB.prepare(
      `UPDATE ${config.table} SET ${sets}, version = version + 1, updated_at = datetime('now') WHERE ${idCol} = ?`
    ).bind(...setValues, targetId).run()
    const updated = await env.DB.prepare(`SELECT version FROM ${config.table} WHERE ${idCol} = ?`).bind(targetId).first<{ version: number }>()
    if (config.afterWrite) await config.afterWrite(env, 'update', targetId, null, { ...data, ...extra, id: targetId })
    return { local_id: item.local_id, status: 'synced', server_id: targetId, server_version: updated?.version ?? 1 }
  }

  const newId = (data.id as string | undefined) || crypto.randomUUID()
  const colNames = [idCol, ...presentCols, ...Object.keys(extra), 'version']
  const placeholders = colNames.map(() => '?').join(', ')
  await env.DB.prepare(`INSERT INTO ${config.table} (${colNames.join(', ')}) VALUES (${placeholders})`).bind(newId, ...setValues, 1).run()
  if (config.afterWrite) await config.afterWrite(env, 'create', newId, null, { ...data, ...extra, id: newId })
  return { local_id: item.local_id, status: 'synced', server_id: newId, server_version: 1 }
}

async function processUpdate(env: Env, config: EntitySyncConfig, item: PushItem, user: UserPayload): Promise<PushResult> {
  const serverId = item.data.id as string | undefined
  if (!serverId) return { local_id: item.local_id, status: 'error', error: 'Server ID required for update' }

  const parseResult = config.updateSchema.safeParse(item.data)
  if (!parseResult.success) {
    return { local_id: item.local_id, status: 'error', error: 'INVALID_DATA: ' + parseResult.error.issues[0]?.message }
  }
  const patch = parseResult.data as Record<string, unknown>

  const current = await fetchCurrentForWrite(env, config, serverId)
  if (!current) return { local_id: item.local_id, status: 'error', error: 'Record not found on server' }

  const transition = config.transitions?.find((t) => patch[t.field] !== undefined && patch[t.field] === t.to)
  const effectiveScope = transition ? transition.scope : (config.writeScope ?? config.scope)

  let scopeOk: boolean
  let scopeErrCode = config.scopeDeniedCode
  if (!transition && config.customWriteCheck) {
    const err = await config.customWriteCheck(env, user, current)
    scopeOk = !err
    scopeErrCode = err ?? config.scopeDeniedCode
  } else {
    scopeOk = await checkScopeRule(env, user, effectiveScope, current)
  }
  if (!scopeOk) {
    return { local_id: item.local_id, status: 'error', error: scopeErrCode }
  }

  // Target-scope re-check hanya berlaku untuk entity yang punya kelas_id/kamar_id
  // sendiri yang bisa dipindah (santri). Entity 'via-santri' (catatan_disiplin)
  // tidak punya konsep "target" — santri_id-nya tidak bisa diubah lewat update.
  if (effectiveScope.kind === 'direct-kamar-kelas') {
    const merged = { ...current, ...patch }
    const targetScopeErr = await checkTargetScopeRule(env, user, config.targetScope ?? effectiveScope, merged)
    if (targetScopeErr) return { local_id: item.local_id, status: 'error', error: targetScopeErr }
  }

  const refErr = await validateRefsForUpdate(env, config.refValidations, current, patch)
  if (refErr) return { local_id: item.local_id, status: 'error', error: refErr }

  if (transition) {
    const currentFieldVal = current[transition.field] as string
    if (!transition.from.includes(currentFieldVal)) {
      return { local_id: item.local_id, status: 'error', error: transition.invalidTransitionCode }
    }
  }

  const currentVersion = current.version as number

  // Conflict: client mengaku punya version lebih lama dari server.
  if (currentVersion > item.version) {
    return persistConflict(env, config, user, serverId, item, currentVersion)
  }
  // item.version > currentVersion = client mengaku punya version yang mustahil
  // (belum pernah ada di server) — tolak sebagai error, JANGAN lanjut ke UPDATE.
  // Kalau dibiarkan lanjut, WHERE version=? pasti 0 rows dan salah kena cabang
  // "race" di bawah, nge-flood sync_conflicts dengan conflict palsu tiap replay.
  if (item.version > currentVersion) {
    return { local_id: item.local_id, status: 'error', error: 'INVALID_VERSION' }
  }

  const updateFields = config.writableColumns.filter((f) => patch[f] !== undefined)
  if (updateFields.length === 0) {
    return { local_id: item.local_id, status: 'synced', server_id: serverId, server_version: currentVersion + 1 }
  }
  const sets = updateFields.map((f) => `${f} = ?`).join(', ')
  const vals = updateFields.map((f) => patch[f])
  const idCol = config.idColumn ?? 'id'

  const stmt = await env.DB.prepare(
    `UPDATE ${config.table} SET ${sets}, version = version + 1, updated_at = datetime('now') WHERE ${idCol} = ? AND version = ?`
  ).bind(...vals, serverId, item.version).run()

  if (stmt.meta.changes === 0) {
    // Concurrent update antara SELECT dan UPDATE (TOCTOU) → treat sebagai
    // conflict DAN persist (bukan cuma dikembalikan di response HTTP — kalau
    // client tidak sempat menerimanya, conflict itu hilang selamanya).
    return persistConflict(env, config, user, serverId, item, currentVersion)
  }

  const after = { ...current, ...patch }
  if (config.afterWrite) await config.afterWrite(env, 'update', serverId, current, after)
  if (transition?.afterWrite) await transition.afterWrite(env, serverId, current, after)

  return { local_id: item.local_id, status: 'synced', server_id: serverId, server_version: currentVersion + 1 }
}

async function processDelete(env: Env, config: EntitySyncConfig, item: PushItem, user: UserPayload): Promise<PushResult> {
  const serverId = item.data.id as string | undefined
  if (!serverId) return { local_id: item.local_id, status: 'error', error: 'Server ID required for delete' }

  const current = await fetchCurrentForWrite(env, config, serverId)
  if (!current) return { local_id: item.local_id, status: 'error', error: 'Record not found on server' }

  if (config.customWriteCheck) {
    const err = await config.customWriteCheck(env, user, current)
    if (err) return { local_id: item.local_id, status: 'error', error: err }
  } else if (!(await checkScopeRule(env, user, config.writeScope ?? config.scope, current))) {
    return { local_id: item.local_id, status: 'error', error: config.scopeDeniedCode }
  }

  const idCol = config.idColumn ?? 'id'
  if (config.softDelete) {
    await env.DB.prepare(
      `UPDATE ${config.table} SET ${config.softDelete.column} = ?, version = version + 1, updated_at = datetime('now') WHERE ${idCol} = ?`
    ).bind(config.softDelete.setValue, serverId).run()
  } else {
    await env.DB.prepare(`DELETE FROM ${config.table} WHERE ${idCol} = ?`).bind(serverId).run()
  }

  if (config.afterWrite) await config.afterWrite(env, 'delete', serverId, current, null)

  return { local_id: item.local_id, status: 'synced', server_id: serverId }
}

export async function processPushItem(env: Env, item: PushItem, user: UserPayload): Promise<PushResult> {
  const config = getEntityConfig(item.entity_type)
  if (!config || config.capability !== 'full') {
    return { local_id: item.local_id, status: 'error', error: 'Unknown entity type' }
  }
  // Mirror requireCanMutate() yang dulu dipasang blanket di level route
  // /api/sync — sekarang per-entity, karena beberapa entity (catatan_personel)
  // SENGAJA mengizinkan kyai menulis, beda dari mayoritas entity lain.
  const blockedRoles = config.readOnlyRoles ?? ['kyai']
  if (blockedRoles.includes(user.role)) {
    return { local_id: item.local_id, status: 'error', error: 'READ_ONLY_ROLE' }
  }
  if (config.disabledActions?.includes(item.action)) {
    return { local_id: item.local_id, status: 'error', error: 'ACTION_NOT_SUPPORTED' }
  }
  switch (item.action) {
    case 'create': return processCreate(env, config, item, user)
    case 'update': return processUpdate(env, config, item, user)
    case 'delete': return processDelete(env, config, item, user)
  }
}

// ============================================================
// Pull
// ============================================================

interface ScopeClauseResult { empty: boolean; clause: string; params: unknown[] }

async function computeDirectScopeClause(
  env: Env, user: UserPayload, kelasCol: string | null, kamarCol: string | null
): Promise<ScopeClauseResult> {
  if (user.role === 'admin' || user.role === 'kyai') return { empty: false, clause: '', params: [] }
  const scopedKamarIds = await resolveKamarScope(env, user)
  const parts: string[] = []
  const params: unknown[] = []
  if (kelasCol && user.role === 'ustadz' && user.kelas_ids.length > 0) {
    parts.push(`${kelasCol} IN (${user.kelas_ids.map(() => '?').join(',')})`)
    params.push(...user.kelas_ids)
  }
  if (kamarCol && scopedKamarIds && scopedKamarIds.length > 0) {
    parts.push(`${kamarCol} IN (${scopedKamarIds.map(() => '?').join(',')})`)
    params.push(...scopedKamarIds)
  }
  if (parts.length === 0) return { empty: true, clause: '', params: [] }
  return { empty: false, clause: `(${parts.join(' OR ')})`, params }
}

interface PullEntityResult { rows: unknown[]; nextCursor: string | null }

async function pullEntity(
  env: Env, user: UserPayload, config: EntitySyncConfig, since: string, cursor: string | null, limit: number
): Promise<PullEntityResult> {
  const idCol = config.idColumn ?? 'id'

  // Scope 'custom' (mis. absensi: kamar murni tanpa kelas) tidak bisa
  // diterjemahkan jadi klausa SQL generik — difilter di JS per baris.
  if (config.scope.kind === 'custom') {
    return pullEntityWithCustomScope(env, user, config, since, cursor, limit)
  }

  let scopeClause = ''
  let scopeParams: unknown[] = []

  if (config.scope.kind === 'direct-kamar-kelas') {
    const kelasCol = config.scope.kelasColumn === null ? null : `${config.table}.${config.scope.kelasColumn ?? 'kelas_id'}`
    const kamarCol = config.scope.kamarColumn === null ? null : `${config.table}.${config.scope.kamarColumn ?? 'kamar_id'}`
    const r = await computeDirectScopeClause(env, user, kelasCol, kamarCol)
    if (r.empty) return { rows: [], nextCursor: null }
    scopeClause = r.clause
    scopeParams = r.params
  } else if (config.scope.kind === 'via-santri') {
    const r = await computeDirectScopeClause(env, user, 'kelas_id', 'kamar_id')
    if (r.empty) return { rows: [], nextCursor: null }
    if (r.clause) {
      scopeClause = `${config.table}.${config.scope.santriIdColumn} IN (SELECT id FROM santri WHERE ${r.clause})`
      scopeParams = r.params
    }
  } else if (config.scope.kind === 'role-only') {
    if (!config.scope.roles.includes(user.role)) return { rows: [], nextCursor: null }
  }
  // 'global' → tanpa filter tambahan.

  let query = `SELECT ${config.table}.*${config.pull.selectExtra ? ', ' + config.pull.selectExtra : ''} FROM ${config.table} ${config.pull.joinExtra ?? ''} WHERE ${config.table}.${config.pull.timestampColumn} > ?`
  const params: unknown[] = [since]
  if (scopeClause) {
    query += ` AND ${scopeClause}`
    params.push(...scopeParams)
  }
  if (cursor) {
    query += ` AND ${config.table}.${idCol} > ?`
    params.push(cursor)
  }
  query += ` ORDER BY ${config.table}.${idCol} ASC LIMIT ?`
  params.push(limit)

  const result = await env.DB.prepare(query).bind(...params).all()
  const rows = result.results || []
  const last = rows[rows.length - 1] as Record<string, unknown> | undefined
  const nextCursor = rows.length >= limit ? ((last?.[idCol] as string) ?? null) : null
  return { rows, nextCursor }
}

/**
 * Pull untuk entity berscope 'custom' — ambil batch kandidat (lebih besar dari
 * `limit` supaya baris yang gagal filter scope tidak bikin halaman jadi
 * kosong), lalu saring per baris lewat checkScopeRule yang sama dipakai push.
 * Cursor lanjut dari baris TERAKHIR YANG DIPERIKSA (bukan cuma yang lolos),
 * supaya baris yang gagal scope tidak diperiksa ulang tiap pull berikutnya.
 */
async function pullEntityWithCustomScope(
  env: Env, user: UserPayload, config: EntitySyncConfig, since: string, cursor: string | null, limit: number
): Promise<PullEntityResult> {
  const idCol = config.idColumn ?? 'id'
  const fetchSize = Math.min(limit * 5, 1000)

  let query = `SELECT ${config.table}.*${config.pull.selectExtra ? ', ' + config.pull.selectExtra : ''} FROM ${config.table} ${config.pull.joinExtra ?? ''} WHERE ${config.table}.${config.pull.timestampColumn} > ?`
  const params: unknown[] = [since]
  if (cursor) {
    query += ` AND ${config.table}.${idCol} > ?`
    params.push(cursor)
  }
  query += ` ORDER BY ${config.table}.${idCol} ASC LIMIT ?`
  params.push(fetchSize)

  const result = await env.DB.prepare(query).bind(...params).all()
  const candidates = (result.results || []) as Record<string, unknown>[]

  const allowed: unknown[] = []
  let lastExaminedId: string | null = null
  for (const row of candidates) {
    // Cek limit SEBELUM menandai baris ini "sudah diperiksa" — kalau berhenti
    // di sini, baris ini belum benar-benar diperiksa scope-nya, jadi harus
    // diperiksa ulang di pull berikutnya (cursor TIDAK maju melewatinya).
    if (allowed.length >= limit) break
    lastExaminedId = row[idCol] as string
    if (await checkScopeRule(env, user, config.scope, row)) {
      allowed.push(row)
    }
  }

  const moreBeyondFetch = candidates.length >= fetchSize
  const nextCursor = (allowed.length >= limit || moreBeyondFetch) ? lastExaminedId : null
  return { rows: allowed, nextCursor }
}

export interface PullResponse {
  changes: Record<string, unknown[]>
  cursors: Record<string, string | null>
  has_more: boolean
  server_time: string
}

export async function processPull(
  env: Env, user: UserPayload, since: string, cursors: Record<string, string | null>, limit: number
): Promise<PullResponse> {
  const changes: Record<string, unknown[]> = {}
  const nextCursors: Record<string, string | null> = {}
  let hasMore = false

  for (const entityType of pullableEntityTypes()) {
    const config = getEntityConfig(entityType)!
    const result = await pullEntity(env, user, config, since, cursors[entityType] ?? null, limit)
    changes[entityType] = result.rows
    nextCursors[entityType] = result.nextCursor
    if (result.nextCursor !== null) hasMore = true
  }

  return { changes, cursors: nextCursors, has_more: hasMore, server_time: new Date().toISOString() }
}

// ============================================================
// Resolve
// ============================================================

export interface ResolveBody {
  resolution: 'use_server' | 'use_client' | 'manual_merge'
  merged_data?: Record<string, unknown>
}

export interface ResolveOutcome { status: number; body: Record<string, unknown> }

export async function processResolve(env: Env, user: UserPayload, conflictId: string, body: ResolveBody): Promise<ResolveOutcome> {
  const conflict = await env.DB.prepare(
    "SELECT * FROM sync_conflicts WHERE id = ? AND status = 'pending'"
  ).bind(conflictId).first<{
    id: string; entity_type: string; entity_id: string; user_id?: string
    server_version: number; client_data: string; server_data: string
  }>()

  if (!conflict) {
    return { status: 404, body: { error: 'Not Found', code: 'CONFLICT_NOT_FOUND', message: 'Conflict tidak ditemukan atau sudah diresolve.' } }
  }

  if (user.role !== 'admin' && conflict.user_id && conflict.user_id !== user.sub) {
    return { status: 403, body: { error: 'Forbidden', code: 'CONFLICT_NOT_OWNED', message: 'Anda hanya dapat me-resolve conflict milik Anda sendiri.' } }
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
        return { status: 400, body: { error: 'Bad Request', code: 'MISSING_MERGED_DATA', message: 'Data hasil merge harus disertakan.' } }
      }
      resolvedData = body.merged_data
      break
  }

  const config = getEntityConfig(conflict.entity_type)

  if (config) {
    const blockedRoles = config.readOnlyRoles ?? ['kyai']
    if (blockedRoles.includes(user.role)) {
      return { status: 403, body: { error: 'Forbidden', code: 'READ_ONLY_ROLE', message: 'Peran Anda bersifat read-only.' } }
    }
  }

  if (resolvedData && config) {
    const updateFields = Object.entries(resolvedData).filter(([k, v]) => config.writableColumns.includes(k) && v !== undefined)

    if (updateFields.length > 0) {
      const current = await fetchCurrentForWrite(env, config, conflict.entity_id)
      if (!current) {
        return { status: 404, body: { error: 'Not Found', code: config.notFoundCode, message: 'Data tidak ditemukan.' } }
      }

      if (config.customWriteCheck) {
        const err = await config.customWriteCheck(env, user, current)
        if (err) return { status: 403, body: { error: 'Forbidden', code: err, message: 'Anda tidak memiliki akses ke data ini.' } }
      } else if (!(await checkScopeRule(env, user, config.writeScope ?? config.scope, current))) {
        return { status: 403, body: { error: 'Forbidden', code: config.scopeDeniedCode, message: 'Anda tidak memiliki akses ke data ini.' } }
      }

      const patch = Object.fromEntries(updateFields) as Record<string, unknown>
      const merged = { ...current, ...patch }

      if (config.scope.kind === 'direct-kamar-kelas') {
        const targetScopeErr = await checkTargetScopeRule(env, user, config.targetScope ?? config.scope, merged)
        if (targetScopeErr) {
          return { status: 403, body: { error: 'Forbidden', code: targetScopeErr, message: 'Hasil resolve di luar scope Anda.' } }
        }
      }

      const refErr = await validateRefsForUpdate(env, config.refValidations, current, patch)
      if (refErr) {
        return { status: 400, body: { error: 'Bad Request', code: refErr, message: 'Data hasil resolve tidak valid.' } }
      }

      const sets = updateFields.map(([k]) => `${k} = ?`).join(', ')
      const vals = updateFields.map(([, v]) => v)
      const idCol = config.idColumn ?? 'id'
      // version = version + 1 dengan guard WHERE version = <server_version yang
      // tercatat saat conflict dibuat> — BUKAN SET version = server_version + 1
      // tanpa guard, supaya tulisan yang lebih baru (terjadi setelah conflict
      // tercatat) tidak tertimpa diam-diam oleh resolve yang masih pegang
      // version lama.
      const stmt = await env.DB.prepare(
        `UPDATE ${config.table} SET ${sets}, version = version + 1, updated_at = datetime('now') WHERE ${idCol} = ? AND version = ?`
      ).bind(...vals, conflict.entity_id, conflict.server_version).run()

      if (stmt.meta.changes === 0) {
        return { status: 409, body: { error: 'Conflict', code: 'CONFLICT_STALE', message: 'Data sudah berubah lagi sejak conflict ini tercatat. Silakan resolve ulang dengan data terbaru.' } }
      }

      if (config.afterWrite) await config.afterWrite(env, 'update', conflict.entity_id, current, merged)
    }
  }

  await env.DB.prepare(
    "UPDATE sync_conflicts SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?"
  ).bind(user.sub, conflictId).run()

  return { status: 200, body: { message: 'Conflict berhasil diresolve.' } }
}

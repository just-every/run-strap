import { preferencesOf } from './domain/preferences'
// API-002/API-003: the integration door. GET only, Bearer integration secret, a required schema
// version, 60 counted requests per key in any rolling 60 seconds, and opaque-cursor pages.
import type { Bindings } from '../auth.server'
import { loadSystem } from './domain/store'
import { list, shortName } from './domain/types'
import { studioSettings } from './domain/studio'
import { hash } from './credentials'
import { booleanAttendanceReads, eventDelivery, keyLocations, scopeCatalogue } from './integrations'
import { locations as allLocations } from './domain/locations'
import { attendanceRows, memberRefs } from './integration-attendance'

export const schemaVersions = ['1']
export const rateLimit = { requests: 60, windowSeconds: 60 }
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'strap-schema-version': schemaVersions.at(-1)! }
type Refusal = { status: number; code: string; extra?: Record<string, unknown>; headers?: Record<string, string> }
function refuse(status: number, code: string, extra: Record<string, unknown> = {}, more: Record<string, string> = {}): never { throw { status, code, extra, headers: more } satisfies Refusal }

/** Pages of 1–100 (default 50) after an opaque cursor; anything else is refused, never clamped. */
function page(url: URL) {
  const raw = url.searchParams.get('limit')
  if (raw !== null && !/^\d{1,3}$/.test(raw)) refuse(400, 'invalid_limit', { min: 1, max: 100 })
  const limit = raw === null ? 50 : Number(raw)
  if (limit < 1 || limit > 100) refuse(400, 'invalid_limit', { min: 1, max: 100 })
  const cursor = url.searchParams.get('cursor')
  if (cursor === null) return { limit, after: null }
  let after: unknown
  try { after = JSON.parse(atob(cursor.replace(/^c1\./, '').replace(/-/g, '+').replace(/_/g, '/'))) } catch { refuse(400, 'invalid_cursor') }
  if (!cursor.startsWith('c1.') || !Array.isArray(after) || after.length !== 2 || after.some(v => typeof v !== 'string' || v.length > 100)) refuse(400, 'invalid_cursor')
  return { limit, after: after as [string, string] }
}
const cursorAfter = (entry: { start: string; id: string }) => 'c1.' + btoa(JSON.stringify([entry.start, entry.id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Both scopes page the same classes. Attendance exposes outcome rows (API-003) to a key holding a
 * member-reference key and booleans only to older keys; roster fields remain unchanged. Erased people never appear. */
async function classPage(env: Bindings, url: URL, granted: string[], attendance: 'roster' | 'boolean' | 'outcomes' = 'roster', refKey: string | null = null) {
  const { limit, after } = page(url), { state } = await loadSystem(env.DB)
  // Another location's data is refused, not silently filtered away, when a key asks for it by name.
  const asked = url.searchParams.get('location')
  if (asked !== null && !granted.includes(asked)) refuse(403, 'location_not_granted', { locations: granted })
  const people = new Map(state.people.filter(p => !p.erasedAt && preferencesOf(state,p.id).attendanceSharing).map(p => [p.id, p]))
  const classes = list(state, 'class').filter(c => !c.privatePersonId).filter(c => granted.includes(c.locationId ?? 'studio')).sort((a, b) => a.start === b.start ? (a.id < b.id ? -1 : 1) : a.start < b.start ? -1 : 1)
    .filter(c => !after || c.start > after[0] || (c.start === after[0] && c.id > after[1]))
  const shown = classes.slice(0, limit), bookings = list(state, 'booking')
  const refs = attendance === 'outcomes' ? await memberRefs(refKey!, [...people.values()]) : new Map<string, string>()
  return {
    location: { id: granted[0], name: allLocations(state).find(l => l.id === granted[0])?.name ?? null },
    locations: allLocations(state).filter(l => granted.includes(l.id)).map(l => ({ id: l.id, name: l.name })),
    data: shown.map(c => attendance === 'outcomes' ? {
      id: c.id, title: c.title, service: c.service, start: c.start, end: c.end, status: c.status,
      attendance: attendanceRows(bookings.filter(b => b.classId === c.id), people, refs),
    } : attendance === 'boolean' ? {
      id: c.id,
      attendance: bookings.filter(b => b.classId === c.id && b.status === 'booked' && people.has(b.personId))
        .map(b => ({ bookingId: b.id, attended: b.attendance === 'attended' })),
    } : {
      id: c.id, title: c.title, service: c.service, start: c.start, end: c.end, capacity: c.capacity, status: c.status,
      roster: bookings.filter(b => b.classId === c.id && people.has(b.personId))
        .map(b => ({ bookingId: b.id, status: b.status, attendee: shortName(people.get(b.personId)!.name) })),
    }),
    page: { limit, next: classes.length > limit ? cursorAfter(shown.at(-1)! as { start: string; id: string }) : null },
  }
}

const route = (path: string) => /^[\w/.-]{1,120}$/.test(path) ? path : '/api/strap/integration/(unrecognized)'

export async function integrationResponse(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url), at = Date.now()
  let key: any = null
  const respond = async (status: number, value: Record<string, unknown>, more: Record<string, string> = {}) => {
    if (key) await env.DB.batch([
      env.DB.prepare('INSERT INTO st_integration_requests(integration_id,at,method,route,status,code) VALUES(?,?,?,?,?,?)').bind(key.id, at, request.method.slice(0, 10), route(url.pathname), status, typeof value.error === 'string' ? value.error : null),
      env.DB.prepare('DELETE FROM st_integration_requests WHERE integration_id=? AND seq NOT IN (SELECT seq FROM st_integration_requests WHERE integration_id=? ORDER BY seq DESC LIMIT 100)').bind(key.id, key.id),
    ])
    return Response.json(value, { status, headers: { ...headers, ...more } })
  }
  try {
    if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) refuse(403, 'wrong_origin')
    const token = request.headers.get('authorization')?.match(/^Bearer (strap_int_[0-9a-f]{64})$/)?.[1]
    if (!token) refuse(401, 'integration_credential_required')
    key = await env.DB.prepare(`SELECT i.*,s.revoked_at AS secret_revoked_at,o.id AS owner_active FROM st_integration_secrets s JOIN st_integrations i ON i.id=s.integration_id
      LEFT JOIN oa_operators o ON o.id=i.owner_id AND o.role='owner' AND o.status='active' AND o.version=i.owner_version WHERE s.token_hash=?`).bind(await hash(token!)).first<any>()
    if (!key) refuse(401, 'integration_credential_invalid')
    if (key.revoked_at || key.secret_revoked_at || !key.owner_active) refuse(401, 'integration_credential_revoked')
    // Every request made with a live secret counts, whatever its outcome, except those refused here.
    const window = at - rateLimit.windowSeconds * 1000
    const [counted] = await env.DB.batch([
      env.DB.prepare('INSERT INTO st_integration_rate(integration_id,at) SELECT ?,? WHERE (SELECT count(*) FROM st_integration_rate WHERE integration_id=? AND at>?)<?').bind(key.id, at, key.id, window, rateLimit.requests),
      env.DB.prepare('DELETE FROM st_integration_rate WHERE integration_id=? AND at<=?').bind(key.id, window),
    ])
    if (counted.meta.changes !== 1) {
      const oldest = await env.DB.prepare('SELECT min(at) AS at FROM st_integration_rate WHERE integration_id=? AND at>?').bind(key.id, window).first<{ at: number }>()
      const retry = Math.min(rateLimit.windowSeconds, Math.max(1, Math.ceil((Number(oldest?.at ?? at) + rateLimit.windowSeconds * 1000 - at) / 1000)))
      refuse(429, 'rate_limited', { ...rateLimit, retryAfterSeconds: retry }, { 'retry-after': String(retry) })
    }
    if (request.method !== 'GET') refuse(405, 'read_only', {}, { allow: 'GET' })
    const version = request.headers.get('strap-schema-version')
    if (version === null) refuse(400, 'schema_version_required', { supported: schemaVersions })
    if (!schemaVersions.includes(version!)) refuse(400, 'unsupported_schema_version', { supported: schemaVersions })
    const scopes: string[] = JSON.parse(key.scopes)
    if (url.pathname === '/api/strap/integration/key') return await respond(200, {
      schemaVersion: version, id: key.id, label: key.label, location: key.location, locations: keyLocations(key), rateLimit,
      scopes: scopes.map(scope => ({ name: scope, ...scopeCatalogue[scope as keyof typeof scopeCatalogue], ...(scope === 'attendance:read' && !key.member_ref_key ? { reads: booleanAttendanceReads } : {}) })),
      events: JSON.parse(key.events).map((name: string) => ({ name, delivery: eventDelivery })),
    })
    if (url.pathname === '/api/strap/integration/roster' && scopes.includes('roster:read')) return await respond(200, { schemaVersion: version, scope: 'roster:read', ...await classPage(env, url, keyLocations(key)) })
    if (url.pathname === '/api/strap/integration/attendance' && scopes.includes('attendance:read')) return await respond(200, { schemaVersion: version, scope: 'attendance:read', ...await classPage(env, url, keyLocations(key), key.member_ref_key ? 'outcomes' : 'boolean', key.member_ref_key) })
    refuse(403, 'scope_not_granted', { scopes })
  } catch (error) {
    const refusal = error as Refusal
    if (typeof refusal?.code !== 'string') throw error
    return respond(refusal.status, { error: refusal.code, ...refusal.extra }, refusal.headers)
  }
}

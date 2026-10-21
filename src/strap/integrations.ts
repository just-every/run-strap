// API-002: owner-created integration keys. Each key holds scopes from a fixed read-only
// catalogue for the studio's one location; Strap keeps only hashes of its secrets.
import type { Bindings } from '../auth.server'
import type { Actor } from './domain'
import { fail, hash } from './credentials'

/** The whole catalogue. A scope lists the events a key holding it may subscribe to. */
export const scopeCatalogue = {
  'roster:read': { label: 'Read class rosters', reads: 'Classes, each booking’s status and each attendee’s first name and last initial', events: ['class.changed', 'booking.changed'] },
} as const
type Scope = keyof typeof scopeCatalogue
/** Until STUDIO-002 adds locations, the studio has exactly one, and every key covers it. */
export const locations = ['studio']
export const eventDelivery = 'not_delivered'
/** Commands that issue a secret run only from the owner's Integrations page, never the JSON API. */
export const inAppOnly = ['integration.create', 'integration.rotate']

const secret = () => 'strap_int_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
const names = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.length > 20 || value.some(v => typeof v !== 'string') || new Set(value).size !== value.length) fail(`invalid_${field}`)
  return value as string[]
}
function eventsFor(scopes: Scope[], value: unknown) {
  const events = value === undefined ? [] : names(value, 'events')
  for (const event of events) if (!scopes.some(scope => (scopeCatalogue[scope].events as readonly string[]).includes(event))) fail('event_not_permitted')
  return events
}
const subscriptions = (events: string[]) => events.map(name => ({ name, delivery: eventDelivery }))

async function ownKey(env: Bindings, who: Actor, input: Record<string, unknown>) {
  const key = await env.DB.prepare('SELECT * FROM st_integrations WHERE id=? AND owner_id=?').bind(String(input.id ?? ''), who.id).first<any>()
  if (!key) fail('integration_not_found', 404)
  return key
}

export async function integrationCommand(env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  // Only the native human owner's session; agent keys, integration keys and every other role are refused.
  if (who.role !== 'owner' || !who.isOwner) fail('owner_required', 403)
  const at = Date.now()
  if (name === 'integration.create') {
    const label = String(input.label ?? '').trim()
    if (!label || label.length > 80) fail('Enter a label of at most 80 characters')
    const scopes = names(input.scopes, 'scopes') as Scope[]
    if (!scopes.length || scopes.some(scope => !(scope in scopeCatalogue))) fail('scope_not_in_catalogue')
    if (!locations.includes(String(input.location))) fail('unknown_location')
    const events = eventsFor(scopes, input.events), id = crypto.randomUUID(), token = secret()
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO st_integrations(id,owner_id,owner_version,label,scopes,location,events,created_at,updated_at)
        SELECT ?,id,version,?,?,?,?,?,? FROM oa_operators WHERE id=? AND role='owner' AND status='active'`).bind(id, label, JSON.stringify(scopes), String(input.location), JSON.stringify(events), at, at, who.id),
      env.DB.prepare('INSERT INTO st_integration_secrets(token_hash,integration_id,created_at) SELECT ?,id,? FROM st_integrations WHERE id=?').bind(await hash(token), at, id),
    ])
    if (results[0].meta.changes !== 1) fail('Owner access changed', 403)
    return { id, label, token, scopes, location: String(input.location), events: subscriptions(events) }
  }
  const key = await ownKey(env, who, input)
  if (name === 'integration.revoke') {
    await env.DB.batch([
      env.DB.prepare('UPDATE st_integrations SET revoked_at=?,updated_at=? WHERE id=? AND revoked_at IS NULL').bind(at, at, key.id),
      env.DB.prepare('UPDATE st_integration_secrets SET revoked_at=? WHERE integration_id=? AND revoked_at IS NULL').bind(at, key.id),
    ])
    return { id: key.id, revoked: true }
  }
  if (key.revoked_at) fail('integration_revoked', 409)
  if (name === 'integration.rotate') {
    // The new secret and the old one's revocation commit together: the old one stops at once.
    const token = secret(), tokenHash = await hash(token)
    const results = await env.DB.batch([
      env.DB.prepare('INSERT INTO st_integration_secrets(token_hash,integration_id,created_at) SELECT ?,id,? FROM st_integrations WHERE id=? AND revoked_at IS NULL').bind(tokenHash, at, key.id),
      env.DB.prepare('UPDATE st_integration_secrets SET revoked_at=? WHERE integration_id=? AND revoked_at IS NULL AND token_hash<>?').bind(at, key.id, tokenHash),
      env.DB.prepare('UPDATE st_integrations SET updated_at=? WHERE id=?').bind(at, key.id),
    ])
    if (results[0].meta.changes !== 1) fail('integration_revoked', 409)
    return { id: key.id, label: key.label, token, rotatedAt: at }
  }
  if (name === 'integration.events') {
    const events = eventsFor(JSON.parse(key.scopes), input.events)
    await env.DB.prepare('UPDATE st_integrations SET events=?,updated_at=? WHERE id=? AND revoked_at IS NULL').bind(JSON.stringify(events), at, key.id).run()
    return { id: key.id, events: subscriptions(events) }
  }
  fail('Unknown integration command', 404)
}

/** The owner's own keys with their usage and failure log; nobody else reads them. */
export async function integrationKeys(env: Bindings, who: Actor) {
  if (who.role !== 'owner') return []
  const [keys, log] = await env.DB.batch<any>([
    env.DB.prepare('SELECT id,label,scopes,location,events,created_at AS createdAt,updated_at AS updatedAt,revoked_at AS revokedAt FROM st_integrations WHERE owner_id=? ORDER BY created_at DESC').bind(who.id),
    env.DB.prepare(`SELECT r.integration_id AS integrationId,r.at,r.method,r.route,r.status,r.code FROM st_integration_requests r
      JOIN st_integrations i ON i.id=r.integration_id WHERE i.owner_id=? ORDER BY r.seq DESC`).bind(who.id),
  ])
  return keys.results.map(key => {
    const requests = log.results.filter(row => row.integrationId === key.id)
    return { ...key, scopes: JSON.parse(key.scopes), events: subscriptions(JSON.parse(key.events)), lastUsedAt: requests[0]?.at ?? null, requests }
  })
}

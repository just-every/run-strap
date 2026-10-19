import type { Bindings } from '../../auth.server'
import type { Actor } from '../domain'
import { fail } from '../credentials'

// ATT-001 kiosk devices. Only the human owner pairs one, from a signed-in owner
// session: pairing makes a one-time link (15 minutes) whose secret is stored
// hashed; opening it on the device and confirming mints a 32-byte random device
// token, kept hashed and set as an HttpOnly cookie on the /kiosk path only. The
// owner revokes a kiosk by name; its next request is refused.
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
const secret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const kioskCookie = 'strap_kiosk'
const pairingMinutes = 15

export async function kioskDevices(env: Bindings, who: Actor) {
  if (who.role !== 'owner') return []
  return (await env.DB.prepare('SELECT id,label,created_at AS createdAt,paired_at AS pairedAt,revoked_at AS revokedAt,pair_expires_at AS pairExpiresAt FROM st_kiosks ORDER BY created_at DESC').all()).results
}

export async function kioskDeviceCommand(env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (who.role !== 'owner' || !who.isOwner) fail('Only the owner manages kiosks', 403)
  if (name === 'kiosk.pair') {
    const label = String(input.label ?? '').trim()
    if (!label || label.length > 80) fail('Name the kiosk in at most 80 characters')
    const id = crypto.randomUUID(), pairing = secret(), at = Date.now(), expiresAt = at + pairingMinutes * 60_000
    const result = await env.DB.prepare(`INSERT INTO st_kiosks(id,label,created_by,created_at,pair_hash,pair_expires_at)
      SELECT ?,?,id,?,?,? FROM oa_operators WHERE id=? AND role='owner' AND status='active'`).bind(id, label, at, await hash(pairing), expiresAt, who.id).run()
    if (result.meta.changes !== 1) fail('Owner access changed', 403)
    return { id, label, pairUrl: `${env.AUTH_ORIGIN}/kiosk/pair?token=${pairing}`, expiresAt }
  }
  if (name === 'kiosk.revoke') {
    const result = await env.DB.prepare('UPDATE st_kiosks SET revoked_at=?,pair_hash=NULL WHERE id=? AND revoked_at IS NULL').bind(Date.now(), String(input.id ?? '')).run()
    if (result.meta.changes !== 1) fail('Kiosk not found or already revoked', 404)
    return { revoked: true }
  }
  fail('Unknown kiosk command', 404)
}

/** Consumes the pairing secret once; returns the device token for the cookie. */
export async function pairKiosk(env: Bindings, pairing: string) {
  if (!pairing || pairing.length > 100) return null
  const token = secret()
  const row = await env.DB.prepare(`UPDATE st_kiosks SET token_hash=?,paired_at=?,pair_hash=NULL,pair_expires_at=NULL
    WHERE pair_hash=? AND pair_expires_at>? AND revoked_at IS NULL AND token_hash IS NULL RETURNING id`).bind(await hash(token), Date.now(), await hash(pairing), Date.now()).first<{ id: string }>()
  return row ? { id: row.id, token } : null
}

export async function pairingOpen(env: Bindings, pairing: string) {
  if (!pairing || pairing.length > 100) return false
  return !!await env.DB.prepare('SELECT 1 FROM st_kiosks WHERE pair_hash=? AND pair_expires_at>? AND revoked_at IS NULL AND token_hash IS NULL').bind(await hash(pairing), Date.now()).first()
}

/** The paired kiosk behind this request's device cookie, or null. */
export async function kioskOf(request: Request, env: Bindings) {
  const token = (request.headers.get('cookie') ?? '').split(/;\s*/).find(part => part.startsWith(kioskCookie + '='))?.slice(kioskCookie.length + 1)
  if (!token || token.length > 100) return null
  return await env.DB.prepare('SELECT id,label FROM st_kiosks WHERE token_hash=? AND revoked_at IS NULL').bind(await hash(token)).first<{ id: string; label: string }>()
}

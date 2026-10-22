import { inviteMemberRecord } from './member-invitations'
import { operatorAuth, type Bindings } from '../auth.server'
import { actor, type Actor } from './domain'

export const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }
export const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')

// Adapted from Lanyard's native invitation and owner-bound preparation keys.
export async function principal(request: Request, env: Bindings, agent = false): Promise<Actor> {
  if (agent) {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!token || token.length > 200) fail('Agent credential required', 401)
    const key = await env.DB.prepare(`SELECT k.*,o.email FROM st_agent_keys k JOIN oa_operators o ON o.id=k.owner_id
      WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>? AND o.role='owner' AND o.status='active' AND o.version=k.owner_version`).bind(await hash(token!), Date.now()).first<any>()
    if (!key) fail('Agent credential expired or revoked', 401)
    return { id: key.owner_id, email: key.email, role: 'agent', isOwner: true }
  }
  const session = await operatorAuth(env).getSession(request)
  if (!session) fail('Sign in to continue', 401)
  return { ...await actor(env.DB, { userId: session!.operator.id, email: session!.operator.email, isOwner: session!.operator.role === 'owner' }), sessionId: session!.id }
}

export async function agentKeys(env: Bindings, who: Actor) {
  if (who.role !== 'owner') return []
  return (await env.DB.prepare('SELECT id,label,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM st_agent_keys WHERE owner_id=? ORDER BY created_at DESC').bind(who.id).all()).results
}

export async function credentialCommand(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (name === 'member.record.invite') return inviteMemberRecord(request,env,who,input)
  if (who.role !== 'owner') fail('Only the owner manages access', 403)
  if (name === 'agent.create') {
    const label = String(input.label ?? '').trim()
    if (!label || label.length > 80) fail('Enter a label of at most 80 characters')
    const id = crypto.randomUUID(), token = 'strap_' + crypto.randomUUID() + crypto.randomUUID(), at = Date.now()
    const result = await env.DB.prepare(`INSERT INTO st_agent_keys(id,owner_id,owner_version,label,token_hash,created_at,expires_at)
      SELECT ?,id,version,?,?,?,? FROM oa_operators WHERE id=? AND role='owner' AND status='active'`).bind(id, label, await hash(token), at, at + 30 * 86400_000, who.id).run()
    if (result.meta.changes !== 1) fail('Owner access changed', 403)
    return { id, token, expiresAt: at + 30 * 86400_000 }
  }
  if (name === 'agent.revoke') {
    await env.DB.prepare('UPDATE st_agent_keys SET revoked_at=? WHERE id=? AND owner_id=?').bind(Date.now(), String(input.id ?? ''), who.id).run()
    return { revoked: true }
  }
  if (name === 'person.invite') {
    const person = await env.DB.prepare('SELECT * FROM st_people WHERE id=? AND active=1 AND erased_at IS NULL').bind(String(input.id ?? '')).first<any>()
    if (!person) fail('Activate the member or instructor before inviting them', 409)
    await operatorAuth(env).invite(request, { email: person.email, displayName: person.name, role: 'member', returnTo: '/app' })
    return { invited: true }
  }
  fail('Unknown access command', 404)
}

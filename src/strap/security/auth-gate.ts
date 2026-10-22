// Wrap Base's public access-management doors without changing its module or its role policy.
import { operatorAuth, type Bindings } from '../../auth.server'
import { actor } from '../domain'
import { mfaHold } from './gate'

const privileged = new Set(['/auth/invite', '/auth/invite/cancel', '/auth/operator/status', '/auth/operator/role', '/auth/operators', '/auth/sessions', '/auth/session/revoke', '/auth/providers', '/auth/providers/unlink', '/auth/providers/relink', '/auth/domain-rules', '/auth/settings/identity'])
export async function authMfaResponse(request: Request, env: Bindings): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!privileged.has(path)) return null
  const session = await operatorAuth(env).getSession(request)
  if (!session) return null // Base independently refuses missing/invalid sessions.
  try {
    const who = { ...await actor(env.DB, { userId: session.operator.id, email: session.operator.email, isOwner: session.operator.role === 'owner' }), sessionId: session.id }
    // Product-scoped front-desk invitations must use member.record.invite.
    // No generic Base account-management door is available, even after MFA.
    if (who.role === 'front-desk') return Response.json({error:'member_record_route_required'},{status:403,headers:{'cache-control':'no-store'}})
    const hold = await mfaHold(env, who, { path, privileged: true })
    if (!hold && who.role !== 'finance' && who.role !== 'manager') return null
    return Response.json({ error: hold?.code ?? `${who.role}_reports_only` }, { status: 403, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: 'access_refused' }, { status: Number((error as any).status) || 403, headers: { 'cache-control': 'no-store' } })
  }
}

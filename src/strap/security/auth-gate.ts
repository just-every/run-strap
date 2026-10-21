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
    const hold = await mfaHold(env, who, { path, privileged: true })
    if (!hold && who.role !== 'finance') return null
    return Response.json({ error: hold?.code ?? 'finance_reports_only' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: 'access_refused' }, { status: Number((error as any).status) || 403, headers: { 'cache-control': 'no-store' } })
  }
}

import type { Bindings } from '../auth.server'
import type { Actor } from './domain'
import { seal, unseal } from './security/crypto'

type Notice = { message?: string; error?: string; result?: unknown }
const lifetime = 120
const targetOf = (target: string, env: Bindings) => { const url = new URL(target, env.AUTH_ORIGIN); return url.pathname + url.search }
const name = (env: Bindings) => `strap_action_result_${new URL(env.AUTH_ORIGIN).port || 'host'}`
const cookie = (env: Bindings, value: string, age: number) => `${name(env)}=${value}; Path=/app; HttpOnly; SameSite=Strict; Max-Age=${age}${env.AUTH_ORIGIN.startsWith('https:') ? '; Secure' : ''}`
const binding = (who: Actor) => `strap-action-result:${who.id}:${who.sessionId}`

/** Carry a small private result across POST/redirect/GET without putting a secret in a URL.
 * The encrypted, short-lived cookie belongs to this native session and destination only.
 * Reading the result clears it, so ordinary refreshes neither resubmit nor redisplay a key.
 */
export async function actionResultRedirect(env: Bindings, who: Actor, target: string, notice: Notice) {
  const payload = new TextEncoder().encode(JSON.stringify({ target: targetOf(target, env), expiresAt: Date.now() + lifetime * 1000, notice }))
  const value = await seal(env.SESSION_SECRET, payload, binding(who))
  return new Response(null, { status: 303, headers: {
    location: target, 'set-cookie': cookie(env, value, lifetime), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  } })
}

export async function actionResult(request: Request, env: Bindings, who: Actor) {
  const value = (request.headers.get('cookie') ?? '').split(/;\s*/).find(part => part.startsWith(name(env) + '='))?.slice(name(env).length + 1)
  if (!value) return { notice: {} as Notice, clear: null }
  const clear = cookie(env, '', 0)
  const bytes = await unseal(env.SESSION_SECRET, value, binding(who))
  if (!bytes) return { notice: {} as Notice, clear }
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes))
    if (payload.expiresAt < Date.now()) return { notice: {} as Notice, clear }
    if (payload.target !== targetOf(request.url, env)) return { notice: {} as Notice, clear: null }
    return { notice: payload.notice as Notice, clear }
  } catch { return { notice: {} as Notice, clear } }
}

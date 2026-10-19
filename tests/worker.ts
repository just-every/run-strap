// The same production auth and product HTTP handlers, on real workerd and D1.
import { authResponse, runtimeBindings, type Bindings } from '../src/auth.server'
import { lobbyResponse } from '../src/base/lobby'
import { setupStateResponse } from '../src/base/setup-state'
import { identity } from '../src/identity'
import { strapResponse, strapScheduled } from '../src/strap/http'
export default { async fetch(request: Request, env: Bindings) {
  return await authResponse(request, env) ?? await strapResponse(request, env)
    ?? await setupStateResponse(request, runtimeBindings(env))
    ?? await lobbyResponse(request, runtimeBindings(env), identity)
    ?? new Response('Not found', { status: 404 })
}, async scheduled(_controller: ScheduledController, env: Bindings) { await strapScheduled(env) } }

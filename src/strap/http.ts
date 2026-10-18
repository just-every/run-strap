import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { command, snapshot, type Actor } from './domain'
import { importCommand } from './movein'
import { agentKeys, credentialCommand, fail, principal } from './credentials'
import { renderApp } from './ui'
import { formInput } from './forms'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const pages = new Set(['/app', '/app/classes', '/app/people', '/app/packs', '/app/import', '/app/agent', '/app/studio'])
const preparations = ['classes.prepare', 'pack.prepare', 'reminder.prepare']

async function state(env: Bindings, who: Actor) {
  const importJobs = who.role === 'owner' ? (await env.DB.prepare("SELECT id,state,checkpoint,total,fingerprint,error FROM ik_jobs WHERE destination='strap:members' AND namespace='strap.mindbody.csv.v1' AND mapping_version='mindbody-members-v1' AND principal_id=? ORDER BY rowid DESC LIMIT 30").bind(who.id).all()).results : []
  const operator = await env.DB.prepare('SELECT display_name AS name FROM oa_operators WHERE id=?').bind(who.id).first<{ name: string }>()
  return { ...await snapshot(env.DB, who), agentKeys: await agentKeys(env, who), importJobs, displayName: operator?.name ?? '' }
}

async function execute(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (name.startsWith('agent.') || name === 'person.invite') return credentialCommand(request, env, who, name, input)
  if (name.startsWith('import.')) return importCommand(env.DB, who, name, input)
  return command(env.DB, who, name, input)
}

async function inputBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > 9_100_000) fail('Request is too large', 413)
  if (request.headers.get('content-type')?.includes('application/json')) {
    let input; try { input = JSON.parse(raw) } catch { fail('Invalid JSON') }
    if (!input || Array.isArray(input) || typeof input !== 'object') fail('Expected an object')
    return input
  }
  if (!request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) fail('Use JSON or a form', 415)
  return Object.fromEntries(new URLSearchParams(raw))
}

export async function strapResponse(request: Request, original: Bindings): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname
  if (!path.startsWith('/api/strap/') && path !== '/app' && !path.startsWith('/app/')) return null
  const env = runtimeBindings(original), isAgent = path.startsWith('/api/strap/agent/')
  let who: Actor | undefined
  // Back to the page (and its view, such as one person or one class) the form came from.
  const returnTo = url.searchParams.get('returnTo') ?? ''
  const back = /^\/app[\w/-]*(?:\?[\w=&%.-]*)?$/.test(returnTo) && pages.has(returnTo.split('?')[0]) ? returnTo : '/app'
  try {
    if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) fail('Wrong application origin', 403)
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    if (request.method === 'POST' && !isAgent && (request.headers.get('origin') !== env.AUTH_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site')) fail('Cross-site request refused', 403)
    who = await principal(request, env, isAgent)
    if (request.method === 'GET') {
      if (pages.has(path)) return renderApp(await state(env, who), path + url.search)
      if (path === '/api/strap/state' || path === '/api/strap/agent/context') return json(await state(env, who))
      if (path === '/api/strap/commands') return json({ preparations, approval: 'Native owner session required; agent keys cannot approve.', human: ['classes.publish', 'pack.approve', 'reminder.approve'] })
      const reminderFile = path.match(/^\/api\/strap\/reminders\/([\w-]+)\.txt$/)
      if (reminderFile) {
        if (who.role !== 'owner') fail('Only the owner exports reminders', 403)
        const current = await snapshot(env.DB, who)
        const draft = current.drafts.find((d: any) => d.id === reminderFile[1] && d.type === 'reminder' && d.status === 'approved')
        if (!draft) fail('Approved reminder not found', 404)
        return new Response(`To: ${draft!.recipient}\nSubject: ${draft!.subject}\n\n${draft!.body}\n`, { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="strap-reminder-${reminderFile[1]}.txt"` } })
      }
    } else {
      if (path === '/app/action') {
        const name = url.searchParams.get('name') ?? ''
        const current = await state(env, who)
        const input = formInput(name, await inputBody(request), current.studio?.timeZone)
        if (name === 'session.signout') {
          const response = await operatorAuth(env).signOut(request)
          const next = new Headers({ ...headers, 'set-cookie': response.cookie, location: '/signin' })
          return new Response(null, { status: 303, headers: next })
        }
        if (name === 'person.save' && !('active' in input)) input.active = false
        const result = await execute(request, env, who, name, input)
        // A refresh after booking or approving must read the result, rather
        // than resubmit the mutation. These three commands need an immediate
        // private result document (source review, journal or one-time key).
        if (!['import.preview', 'import.journal', 'agent.create'].includes(name)) return new Response(null, { status: 303, headers: { ...headers, location: back } })
        return renderApp(await state(env, who), back, { message: 'Saved.', result: name === 'import.preview' ? { ...(result as object), csv: input.csv } : result })
      }
      if (path === '/api/strap/command' || path === '/api/strap/agent/command') {
        const body = await inputBody(request)
        if (typeof body.name !== 'string' || !body.input || typeof body.input !== 'object' || Array.isArray(body.input)) fail('Provide a command name and input object')
        if (isAgent && !preparations.includes(String(body.name))) fail('Agents can only prepare drafts', 403)
        return json(await execute(request, env, who, String(body.name), body.input as Record<string, unknown>))
      }
    }
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    const status = Number((error as any)?.status) || 500
    const message = status < 500 ? (error as Error).message : 'Could not complete this change. Refresh and try again.'
    if (path === '/app/action' && who) return renderApp(await state(env, who), back, { error: message.replace(/_/g, ' ') })
    if (pages.has(path) && status === 401) return new Response(null, { status: 303, headers: { ...headers, location: '/signin?returnTo=' + encodeURIComponent(path) } })
    return json({ error: message }, status)
  }
}

import { reconcileReminderFailures } from './domain/class-reminders'
import { teachingPay } from './domain/teaching-pay'
import { load } from './domain/store'
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { attendanceReport } from './attendance-report'
import { cancellationsCsv } from './cancellations'
import { sendWaiverLaunch, waiverLaunchStatuses } from './waiver-launch'
import { commandCatalogue, command, snapshot, sweep, type Actor } from './domain'
import { importCommand } from './movein'
import { agentKeys, credentialCommand, fail, principal } from './credentials'
import { renderApp } from './ui'
import { formInput } from './forms'
import { exitExport } from './exit-export'
import { kioskResponse } from './kiosk/http'
import { kioskDeviceCommand, kioskDevices } from './kiosk/devices'
import { memberMailConfigured, noticeDeliveries, sendNotices } from './notice-mail'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const pages = new Set(['/app', '/app/classes', '/app/people', '/app/packs', '/app/import', '/app/agent', '/app/studio', '/app/reports', '/app/teaching-pay', '/app/recognition', '/app/leads', '/app/substitutions'])
const preparations = ['recommendation.prepare', 'classes.prepare', 'pack.prepare', 'reminder.prepare', 'booking.change.prepare', 'series.prepare', 'series.change.prepare']

async function state(env: Bindings, who: Actor) {
  const importJobs = who.role === 'owner' ? (await env.DB.prepare("SELECT id,state,checkpoint,total,fingerprint,error FROM ik_jobs WHERE destination='strap:members' AND namespace='strap.mindbody.csv.v1' AND mapping_version='mindbody-members-v1' AND principal_id=? ORDER BY rowid DESC LIMIT 30").bind(who.id).all()).results : []
  const operator = await env.DB.prepare('SELECT display_name AS name FROM oa_operators WHERE id=?').bind(who.id).first<{ name: string }>()
  const current = await snapshot(env.DB, who), deliveries = await noticeDeliveries(env, who.role)
  const bookingActions = current.bookingActions.map(action => { const mail = deliveries.find((d: any) => d.sourceId === (action.mailSourceId ?? action.id)); return mail ? {...action,notice:{...action.notice,mailStatus:mail.status}} : action })
  const launches = who.role === 'owner' ? await waiverLaunchStatuses(env) : []
  const leadOwners = who.role === 'owner' ? (await env.DB.prepare("SELECT id,display_name AS name FROM oa_operators WHERE role='owner' AND status='active'").all()).results : []
  return { ...current, leadOwners, waiverLaunches:current.waiverLaunches.map(launch => ({...launch,status:launches.find((row: any) => row.id === launch.id)?.status ?? launch.status})), bookingActions, agentKeys: await agentKeys(env, who), kiosks: await kioskDevices(env, who), noticeDeliveries: deliveries, origin: who.role === 'owner' ? env.AUTH_ORIGIN : null, importJobs, displayName: operator?.name ?? '' }
}

async function execute(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (name.startsWith('agent.') || name === 'person.invite') return credentialCommand(request, env, who, name, input)
  if (name.startsWith('import.')) return importCommand(env.DB, who, name, input)
  if (name.startsWith('kiosk.')) return kioskDeviceCommand(env, who, name, input)
  if (name === 'booking.bulk.cancel') {
    if (who.role !== 'owner') fail('owner_required',403)
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 200) fail('Choose 1–200 bookings')
    const outcomes = []
    for (const id of [...new Set(input.ids as unknown[])]) {
      try { await execute(request,env,who,'booking.cancel',{...input,id,mode:'early'}); outcomes.push({id,ok:true}) }
      catch (error) { if (Number((error as any).status) >= 500 || !(error as any).status) throw error; outcomes.push({id,ok:false,error:(error as Error).message}) }
    }
    return {bulk:{outcomes}}
  }
  const context = { mailConfigured: memberMailConfigured(env), origin: env.AUTH_ORIGIN, queued: [] as string[] }
  const result = await command(env.DB, who, name, input, context)
  // Emails go out only after the change and their reservations commit.
  await sendNotices(env, context.queued)
  return name === 'waiver.launch' ? sendWaiverLaunch(request,env,result) : result
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

/** The Cron Trigger: expire unclaimed waitlist offers and move each seat on. */
export async function strapScheduled(original: Bindings) {
  const env = runtimeBindings(original), context = { mailConfigured: memberMailConfigured(env), origin: env.AUTH_ORIGIN, queued: [] as string[] }
  await sweep(env.DB, context)
  await sendNotices(env, context.queued)
  await reconcileReminderFailures(env.DB)
}

export async function strapResponse(request: Request, original: Bindings): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname
  if (path === '/kiosk' || path.startsWith('/kiosk/')) return kioskResponse(request, runtimeBindings(original))
  if (!path.startsWith('/api/strap/') && path !== '/app' && !path.startsWith('/app/')) return null
  const env = runtimeBindings(original), isAgent = path.startsWith('/api/strap/agent/')
  let who: Actor | undefined
  // Back to the page (and its view, such as one person or one class) the form came from.
  const returnTo = url.searchParams.get('returnTo') ?? ''
  const back = /^\/app[\w/-]*(?:\?[\w=&%+.-]*)?(?:#[\w-]+)?$/.test(returnTo) && pages.has(returnTo.split(/[?#]/)[0]) ? returnTo : '/app'
  try {
    if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) fail('Wrong application origin', 403)
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    if (request.method === 'POST' && !isAgent && (request.headers.get('origin') !== env.AUTH_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site')) fail('Cross-site request refused', 403)
    who = await principal(request, env, isAgent)
    if (request.method === 'GET') {
      if (path === '/api/strap/teaching-pay') {
        if (!['owner','instructor'].includes(who.role)) fail('staff_required',403)
        const loaded = await load(env.DB,who)
        return json(teachingPay(loaded.state,who.role === 'instructor' ? who.personId : url.searchParams.get('instructorId') ?? undefined,url.searchParams.get('from') ?? undefined,url.searchParams.get('to') ?? undefined))
      }
      if (path === '/api/strap/reports/attendance') {
        if (who.role !== 'owner') fail('owner_required',403)
        return json(attendanceReport(await state(env,who),url.searchParams))
      }
      if (path === '/api/strap/cancellations.csv') {
        if (who.role !== 'owner') fail('owner_required',403)
        return new Response(cancellationsCsv(await state(env,who),url.searchParams),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename=strap-cancellations.csv'}})
      }
      if (path === '/api/strap/exit.json') return await exitExport(env.DB, who)
      if (pages.has(path)) return renderApp(await state(env, who), path + url.search)
      if (path === '/api/strap/state' || path === '/api/strap/agent/context') return json(await state(env, who))
      if (path === '/api/strap/commands') return json({ commands:commandCatalogue(), preparations, approval: 'Native owner session required; agent keys cannot approve.', human: ['classes.publish', 'pack.approve', 'reminder.approve'] })
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
        // than resubmit the mutation. These commands need an immediate
        // private result document (source review, journal, one-time key or pairing link).
        if (!['import.preview', 'import.journal', 'agent.create', 'kiosk.pair', 'booking.bulk.cancel', 'recognition.launch'].includes(name)) return new Response(null, { status: 303, headers: { ...headers, location: back } })
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

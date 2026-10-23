import { intakeTabletResponse } from './intake-tablet'
import { smsConsentWebhook } from './consent-webhook'
import { preferenceExport } from './domain/preferences'
import { memberHistory, requireMemberRecord } from './domain/member-records'
import { historyExport, historyCsv } from './staff-history'
import { retentionReport } from './retention-report'
import { leadReport } from './lead-report'
import { renewalWorklist } from './domain/renewals'
import { reconcileReminderFailures } from './domain/class-reminders'
import { teachingPay } from './domain/teaching-pay'
import { load } from './domain/store'
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { reportDownload, nativeReportDownload } from './report-exports'
import { revenueReport } from './revenue-report'
import { attendanceReport } from './attendance-report'
import { cancellationsCsv } from './cancellations'
import { sendWaiverLaunch, waiverLaunchStatuses } from './waiver-launch'
import { commandCatalogue, command, financeSnapshot, managerSnapshot, snapshot, sweep, type Actor } from './domain'
import { importCommand } from './movein'
import { agentKeys, credentialCommand, fail, principal } from './credentials'
import { inAppOnly, integrationCommand, integrationKeys } from './integrations'
import { integrationResponse } from './integration-api'
import { renderApp } from './ui'
import { formInput } from './forms'
import { exitExport } from './exit-export'
import { kioskResponse } from './kiosk/http'
import { kioskDeviceCommand, kioskDevices } from './kiosk/devices'
import { memberMailConfigured, noticeDeliveries, sendNotices } from './notice-mail'
import { cleared, financeRoute, managerRoute, mfaHold, privilegedCommand, privilegedRoute, privilegedState, reportStaff, staffRightsCommand } from './security/gate'
import { auditEvents, factorCounts, mfaCommand, mfaView } from './security/mfa'
import { financeCommand, financeUsers } from './security/finance'
import { managerCommand, managers } from './security/manager'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const pages = new Set(['/app/intake', '/app/tuition', '/app/households', '/app/household', '/app/makeups', '/app', '/app/classes', '/app/people', '/app/packs', '/app/import', '/app/agent', '/app/studio', '/app/reports', '/app/revenue', '/app/renewals', '/app/retention', '/app/teaching-pay', '/app/recognition', '/app/leads', '/app/substitutions', '/app/profile', '/app/integrations', '/app/security'])
const preparations = ['recommendation.prepare', 'classes.prepare', 'pack.prepare', 'reminder.prepare', 'booking.change.prepare', 'series.prepare', 'series.change.prepare']

/** The owner's list of people who can sign in, with their factor counts, for resets and finance grants. */
async function access(env: Bindings) {
  const counts = await factorCounts(env)
  const operators = (await env.DB.prepare("SELECT id,email,display_name AS name,role FROM oa_operators WHERE status='active' ORDER BY email").all()).results as any[]
  return { operators: operators.map(o => ({ ...o, factors: counts[o.id] ?? 0 })), finance: await financeUsers(env), managers: await managers(env) }
}

async function state(env: Bindings, who: Actor): Promise<Record<string, any>> {
  const human = ['owner', 'finance', 'manager', 'front-desk', 'member', 'instructor'].includes(who.role)
  const mfa = human ? await mfaView(env, who) : null
  if (who.role === 'front-desk') return {...await snapshot(env.DB,who,env.AUTH_ORIGIN),displayName:(await env.DB.prepare('SELECT display_name AS name FROM oa_operators WHERE id=?').bind(who.id).first<{name:string}>())?.name ?? '',mfa};
  if (who.role === 'finance') {
    const operator = await env.DB.prepare('SELECT display_name AS name FROM oa_operators WHERE id=?').bind(who.id).first<{ name: string }>()
    return { ...await financeSnapshot(env.DB, who), classes: [], displayName: operator?.name ?? '', mfa }
  }
  if (who.role === 'manager') {
    const operator = await env.DB.prepare('SELECT display_name AS name FROM oa_operators WHERE id=?').bind(who.id).first<{ name: string }>()
    return { ...await managerSnapshot(env.DB, who), displayName: operator?.name ?? '', mfa }
  }
  const importJobs = who.role === 'owner' ? (await env.DB.prepare("SELECT id,state,checkpoint,total,fingerprint,error FROM ik_jobs WHERE destination='strap:members' AND namespace='strap.mindbody.csv.v1' AND mapping_version='mindbody-members-v1' AND principal_id=? ORDER BY rowid DESC LIMIT 30").bind(who.id).all()).results : []
  const operator = await env.DB.prepare('SELECT display_name AS name FROM oa_operators WHERE id=?').bind(who.id).first<{ name: string }>()
  const current = await snapshot(env.DB, who, env.AUTH_ORIGIN), deliveries = await noticeDeliveries(env, who.role)
  const bookingActions = current.bookingActions.map(action => { const mail = deliveries.find((d: any) => d.sourceId === (action.mailSourceId ?? action.id)); return mail ? {...action,notice:{...action.notice,mailStatus:mail.status}} : action })
  const launches = who.role === 'owner' ? await waiverLaunchStatuses(env) : []
  const leadOwners = who.role === 'owner' ? (await env.DB.prepare("SELECT id,display_name AS name FROM oa_operators WHERE role='owner' AND status='active'").all()).results : []
  const hidden = who.role === 'owner' && !await cleared(env, who) ? Object.fromEntries(privilegedState.map(key => [key, key === 'teachingPay' || key === 'memberMail' ? null : []])) : {}
  return { ...current, mfa, ...(who.role === 'owner' ? { access: await access(env) } : {}), leadOwners, waiverLaunches:current.waiverLaunches.map(launch => ({...launch,status:launches.find((row: any) => row.id === launch.id)?.status ?? launch.status})), bookingActions, agentKeys: await agentKeys(env, who), integrations: await integrationKeys(env, who), kiosks: await kioskDevices(env, who), noticeDeliveries: deliveries, origin: who.role === 'owner' ? env.AUTH_ORIGIN : null, importJobs, displayName: operator?.name ?? '', ...hidden }
}

async function appState(env: Bindings, who: Actor, target: string) {
  const url = new URL(target,env.AUTH_ORIGIN)
  if (who.role !== 'owner' || !['/app/renewals','/app/retention','/app/leads'].includes(url.pathname)) return state(env,who)
  const loaded = await load(env.DB,who)
  if (url.pathname === '/app/leads') return {...await state(env,who),leadReport:leadReport(loaded.state,loaded.who,url.searchParams)}
  return {...await state(env,who),...(url.pathname === '/app/renewals' ? {renewalWorklist:renewalWorklist(loaded.state,loaded.who,url.searchParams)} : {retentionReport:retentionReport(loaded.state,loaded.who,url.searchParams)})}
}

async function execute(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (name.startsWith('mfa.')) return mfaCommand(request, env, who, name, input)
  if (name.startsWith('finance.')) return financeCommand(env, who, name, input)
  if (name.startsWith('manager.')) return managerCommand(env, who, name, input)
  if (name.startsWith('agent.') || name === 'person.invite' || name === 'member.record.invite') return credentialCommand(request, env, who, name, input)
  if (name.startsWith('integration.')) return integrationCommand(env, who, name, input)
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

/** SEC-004: finance users reach their report only; a second factor is asked for before a privileged door and at every door once enrolled. */
async function guard(env: Bindings, who: Actor, path: string, name = '', input: Record<string, unknown> = {}) {
  if (who.role === 'front-desk' && !['/app','/app/intake','/app/people','/app/profile','/app/security','/api/strap/state','/api/strap/member-history','/api/strap/preferences.json','/api/strap/mfa','/app/action','/api/strap/command'].includes(path)) fail('member_record_right_required',403);
  if (who.role === 'front-desk' && name && !['intake.tablet.launch','intake.submit.staff','member.record.create','member.record.invite','profile.save.staff','preferences.save.staff','member.message.send.staff','session.signout'].includes(name) && !name.startsWith('mfa.')) fail('member_record_right_required',403);
  if (who.role === 'finance' && !financeRoute(path) && !name.startsWith('mfa.') && name !== 'session.signout') fail('finance_reports_only', 403)
  if (who.role === 'manager' && !managerRoute(path) && !name.startsWith('mfa.') && name !== 'session.signout') fail('manager_reports_only', 403)
  const hold = await mfaHold(env, who, { path, name, privileged: who.role === 'front-desk' || privilegedRoute(path) || (privilegedCommand(name) || name.startsWith('plan.cancellation.refund.') || name.startsWith('contract.authority.') || name.startsWith('contract.copy.') || name==='contract.jurisdiction.save' || name==='contract.service-value.record') || await staffRightsCommand(env, name, input) })
  if (hold) fail(hold.code, 403)
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
  if (path === '/intake/tablet' || path === '/intake/tablet/start') return intakeTabletResponse(request,runtimeBindings(original))
  if (path === '/api/strap/consent/twilio') return smsConsentWebhook(request,runtimeBindings(original))
  if (path === '/kiosk' || path.startsWith('/kiosk/')) return kioskResponse(request, runtimeBindings(original))
  if (path.startsWith('/api/strap/integration/')) return integrationResponse(request, runtimeBindings(original))
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
    if (!isAgent && path !== '/app/action' && path !== '/api/strap/command') await guard(env, who, path)
    if (request.method === 'GET') {
      if (reportStaff(who) && path === '/app') return new Response(null, { status: 303, headers: { ...headers, location: '/app/revenue' } })
      if (path === '/api/strap/preferences.json') {const loaded=await load(env.DB,who);return Response.json(preferenceExport(loaded.state,loaded.who,url.searchParams.get('personId') ?? who.personId ?? ''),{headers:{...headers,'content-disposition':'attachment; filename=strap-preferences.json'}});}
      if (path === '/api/strap/member-history') {
        const loaded = await load(env.DB,who);return json(memberHistory(loaded.state,loaded.who,url.searchParams.get('personId') ?? ''));
      }
      if (path === '/api/strap/staff-history' || path === '/api/strap/staff-history.csv') {
        if (who.role !== 'owner') fail('owner_required',403)
        // The security audit (factor enrollment, resets, finance grants) joins the staff-made actions in the owner's history.
        const current = await state(env,who)
        current.staffActions = [...current.staffActions,...await auditEvents(env)]
        return path.endsWith('.csv')
          ? new Response(historyCsv(current,url.searchParams),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="strap-staff-history.csv"'}})
          : json(historyExport(current,url.searchParams))
      }
      const exportPath = path.match(/^\/api\/strap\/reports\/(revenue|attendance)\.(csv|xlsx)$/) ?? path.match(/^\/api\/strap\/(cancellations)\.(xlsx)$/)
      if (exportPath) {
        if (who.role !== 'owner' && !(reportStaff(who) && (exportPath[1] === 'revenue' || (who.role === 'manager' && exportPath[1] === 'attendance')))) fail('owner_required',403)
        return reportDownload(await state(env,who),exportPath[1],exportPath[2],url.searchParams)
      }
      const nativeExport = path.match(/^\/api\/strap\/reports\/(retention|renewals)\.(csv|xlsx)$/) ?? path.match(/^\/api\/strap\/(teaching-pay)\.(csv|xlsx)$/)
      if (nativeExport) {
        if (who.role !== 'owner') fail('owner_required',403)
        const loaded = await load(env.DB,who)
        return nativeReportDownload(loaded.state,loaded.who,nativeExport[1],nativeExport[2],url.searchParams)
      }
      if (path === '/api/strap/teaching-pay') {
        if (!['owner','instructor'].includes(who.role)) fail('staff_required',403)
        const loaded = await load(env.DB,who)
        return json(teachingPay(loaded.state,who.role === 'instructor' ? who.personId : url.searchParams.get('instructorId') ?? undefined,url.searchParams.get('from') ?? undefined,url.searchParams.get('to') ?? undefined))
      }
      if (path === '/api/strap/reports/leads') {
        if (who.role !== 'owner') fail('owner_required',403)
        const loaded = await load(env.DB,who)
        return json(leadReport(loaded.state,loaded.who,url.searchParams))
      }
      if (path === '/api/strap/reports/retention') {
        if (who.role !== 'owner') fail('owner_required',403)
        const loaded = await load(env.DB,who), report = retentionReport(loaded.state,loaded.who,url.searchParams)
        return json(report)
      }
      if (path === '/api/strap/reports/renewals') {
        if (who.role !== 'owner') fail('owner_required',403)
        const loaded = await load(env.DB,who), report = renewalWorklist(loaded.state,loaded.who,url.searchParams)
        return json(report)
      }
      if (path === '/api/strap/reports/revenue') {
        if (who.role !== 'owner' && !reportStaff(who)) fail('owner_required',403)
        return json(revenueReport(await state(env,who),url.searchParams))
      }
      if (path === '/api/strap/reports/attendance') {
        if (who.role !== 'owner' && who.role !== 'manager') fail('owner_required',403)
        return json(attendanceReport(await state(env,who),url.searchParams))
      }
      if (path === '/api/strap/cancellations.csv') {
        if (who.role !== 'owner') fail('owner_required',403)
        return new Response(cancellationsCsv(await state(env,who),url.searchParams),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename=strap-cancellations.csv'}})
      }
      if (path === '/api/strap/mfa') return json(await mfaView(env, who))
      if (path === '/api/strap/exit.json') return await exitExport(env.DB, who)
      if (pages.has(path)) return renderApp(await appState(env, who, path + url.search), path + url.search)
      if (path === '/api/strap/state' || path === '/api/strap/agent/context') return json(await state(env, who))
      if (path === '/api/strap/commands') return json({ commands:commandCatalogue(), preparations, approval: 'Native owner session required; agent keys cannot approve.', human: ['classes.publish', 'pack.approve', 'reminder.approve'] })
      const reminderFile = path.match(/^\/api\/strap\/reminders\/([\w-]+)\.txt$/)
      if (reminderFile) {
        if (who.role !== 'owner') fail('Only the owner exports reminders', 403)
        const current = await snapshot(env.DB, who, env.AUTH_ORIGIN)
        const draft = current.drafts.find((d: any) => d.id === reminderFile[1] && d.type === 'reminder' && d.status === 'approved')
        if (!draft) fail('Approved reminder not found', 404)
        return new Response(`To: ${draft!.recipient}\nSubject: ${draft!.subject}\n\n${draft!.body}\n`, { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="strap-reminder-${reminderFile[1]}.txt"` } })
      }
    } else {
      if (path === '/app/action') {
        const name = url.searchParams.get('name') ?? ''
        await guard(env, who, path, name)
        const current = await state(env, who)
        const input = formInput(name, await inputBody(request), current.studio?.timeZone, current.locations)
        if (name === 'session.signout') {
          const response = await operatorAuth(env).signOut(request)
          const next = new Headers({ ...headers, 'set-cookie': response.cookie, location: '/signin' })
          return new Response(null, { status: 303, headers: next })
        }
        if (name === 'person.save' && !('active' in input)) input.active = false
        await guard(env, who, path, name, input)
        const result = await execute(request, env, who, name, input)
        // A refresh after booking or approving must read the result, rather
        // than resubmit the mutation. These commands need an immediate
        // private result document (source review, journal, one-time key or pairing link).
        if (!['intake.tablet.launch', 'import.preview', 'import.journal', 'agent.create', 'integration.create', 'integration.rotate', 'kiosk.pair', 'booking.bulk.cancel', 'recognition.launch', 'mfa.totp.start', 'mfa.totp.confirm', 'mfa.recovery.renew', 'mfa.reset', 'mfa.remove', 'mfa.step-up'].includes(name)) return new Response(null, { status: 303, headers: { ...headers, location: back } })
        return renderApp(await appState(env, who, back), back, { message: 'Saved.', result: name === 'import.preview' ? { ...(result as object), csv: input.csv } : result })
      }
      if (path === '/api/strap/command' || path === '/api/strap/agent/command') {
        const body = await inputBody(request)
        if (typeof body.name !== 'string' || !body.input || typeof body.input !== 'object' || Array.isArray(body.input)) fail('Provide a command name and input object')
        if (isAgent && !preparations.includes(String(body.name))) fail('Agents can only prepare drafts', 403)
        if (!isAgent) await guard(env, who, path, String(body.name), body.input as Record<string, unknown>)
        if (inAppOnly.includes(String(body.name))) fail('integration_secret_in_app_only', 403)
        return json(await execute(request, env, who, String(body.name), body.input as Record<string, unknown>))
      }
    }
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    const status = Number((error as any)?.status) || 500
    const message = status < 500 ? (error as Error).message : 'Could not complete this change. Refresh and try again.'
    const held = status === 403 && /^mfa_(required|enrollment_required)$/.test(message)
    if (path === '/app/action' && who) {
      const target = held ? `/app/security?returnTo=${encodeURIComponent(back)}&hold=${message}` : back
      const page = await renderApp(await appState(env, who, target), target, { error: message.replace(/_/g, ' ') })
      return held || message === 'step_up_required' ? new Response(page.body, { status: 403, headers: { ...Object.fromEntries(page.headers), 'x-strap-refusal': message } }) : page
    }
    if (pages.has(path) && held && who) {
      const target = `/app/security?returnTo=${encodeURIComponent(path)}&hold=${message}`
      const page = await renderApp(await appState(env, who, target), target)
      return new Response(page.body, { status: 403, headers: { ...Object.fromEntries(page.headers), 'x-strap-refusal': message } })
    }
    if (pages.has(path) && status === 401) return new Response(null, { status: 303, headers: { ...headers, location: '/signin?returnTo=' + encodeURIComponent(path) } })
    return json({ error: message }, status)
  }
}

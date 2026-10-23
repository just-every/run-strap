import { intakePage } from './intake'
import { familyTuitionPage } from './family-tuition'
import { makeupsPanel } from './makeups'
import { substitutionsPage } from './substitutions'
import { leadsPage } from './leads'
import { recognitionPage } from './recognition'
import { teachingPayPage } from './teaching-pay'
import { bulkResult } from './booking-actions'
import { revenuePage } from './revenue'
import { renewalsPage } from './renewals'
import { retentionPage } from './retention'
import { reportsPage } from './reports'
import { agentPage } from './agent'
import { securityPage } from './security'
import { integrationsPage } from './integrations'
import { classesPage } from './classes'
import { classesOn, currentClass } from './facts'
import { dayLong, studioToday } from './format'
import { importPage } from './import'
import { memberHome } from './member'
import { memberProfilePage } from './profile'
import { packsPage } from './packs'
import { householdPage, householdsPage } from './households'
import { peoplePage } from './people'
import { emptyState, h, owner } from './shared'
import { shell, tabs, topBar } from './shell'
import { studioPage } from './studio'
import { successRail } from './success'
import { dayNav, today } from './today'

const security = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }

export async function renderApp(state: any, target: string, notice: { message?: string; error?: string; result?: any } = {}): Promise<Response> {
  const url = new URL(target, 'https://strap.invalid'), current = url.pathname.replace(/\/$/, '') || '/app', query = url.searchParams
  const allowed = tabs(state).some(t => t.href === current) || (owner(state) && current === '/app/studio')
  const desk = state.actor.role !== 'member'
  const title = current === '/app' ? (desk ? 'Today' : 'Classes') : current === '/app/studio' ? 'Studio' : tabs(state).find(t => t.href === current)?.label ?? 'Page unavailable'
  const content = !allowed
    ? `<div class="page single"><section class="panel">${emptyState('alert', 'Page unavailable', 'Your role cannot open this page.', '<a class="btn" href="/app">Back to Today</a>')}</section></div>`
    : current === '/app' ? (desk ? today(state, query, owner(state) ? successRail(state, query) : '') : memberHome(state))
      : current === '/app/intake' ? intakePage(state,query,notice) : current === '/app/tuition' ? familyTuitionPage(state,query) : current === '/app/classes' ? classesPage(state, query)
        : current === '/app/households' ? householdsPage(state) : current === '/app/household' ? householdPage(state)
        : current === '/app/profile' ? memberProfilePage(state) : current === '/app/substitutions' ? substitutionsPage(state,notice) : current === '/app/leads' ? leadsPage(state,query) : current === '/app/people' ? peoplePage(state, query)
          : current === '/app/makeups' ? `<div class="page single"><div class="page-main"><div class="page-title"><h1>Absences and makeups</h1></div>${makeupsPanel(state)}</div></div>` : current === '/app/packs' ? packsPage(state, query)
            : current === '/app/renewals' ? renewalsPage(state, query)
            : current === '/app/retention' ? retentionPage(state)
            : current === '/app/import' ? importPage(state, notice)
              : current === '/app/agent' ? agentPage(state, notice)
              : current === '/app/integrations' ? integrationsPage(state, notice)
              : current === '/app/security' ? securityPage(state, query, notice)
                : current === '/app/recognition' ? recognitionPage(state,notice) : current === '/app/teaching-pay' ? teachingPayPage(state) : current === '/app/revenue' ? revenuePage(state,query) : current === '/app/reports' ? reportsPage(state, query) : studioPage(state, notice)
  const todays = classesOn(state, studioToday(state)), now = currentClass(state, todays)
  const day = current === '/app' && desk ? dayNav(state, query) : `<p class="today-date"><span>${h(dayLong(studioToday(state)))}</span></p>`
  const checkIn = now ? `/app?class=${encodeURIComponent(now.id)}#class-${now.id}` : '/app'
  const notices = `${bulkResult(notice)}${notice.error ? `<div class="notice error" role="alert">${h(notice.error)}</div>` : ''}${notice.message ? `<div class="notice" role="status">${h(notice.message)}</div>` : ''}`
  return new Response(shell(state, current, title, topBar(state, day, checkIn), content, notices), { status: allowed ? 200 : 403, headers: current === '/app/security' ? { ...security, 'content-security-policy': security['content-security-policy'] + "; script-src 'self'; connect-src 'self'" } : security })
}

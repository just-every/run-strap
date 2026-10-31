import { coursesPage } from './courses'
import { timeClockPage } from './time-clock'
import { retailPage } from './retail'
import { intakePage } from './intake'
import { familyTuitionPage } from './family-tuition'
import { makeupsPanel } from './makeups'
import { substitutionsPage } from './substitutions'
import { leadsPage, referralsPage } from './leads'
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

const security = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }

export async function renderApp(state: any, target: string, notice: { message?: string; error?: string; result?: any } = {}): Promise<Response> {
  const url = new URL(target, 'https://strap.invalid'), current = url.pathname.replace(/\/$/, '') || '/app', query = url.searchParams
  const allowed = tabs(state).some(t => t.href === current) || (owner(state) && current === '/app/studio')
  const desk = state.actor.role !== 'member'
  const title = current === '/app' ? (desk ? 'Today' : 'Classes') : current === '/app/studio' ? 'Studio' : tabs(state).find(t => t.href === current)?.label ?? 'Page unavailable'
  const content = !allowed
    ? `<div class="page single"><section class="panel">${emptyState('alert', 'Page unavailable', 'Your role cannot open this page.', '<a class="btn" href="/app">Back to Today</a>')}</section></div>`
    : current === '/app' ? (desk ? today(state, query, owner(state) ? successRail(state, query) : '') : memberHome(state))
      : current === '/app/courses' ? coursesPage(state) : current === '/app/time-clock' ? timeClockPage(state) : current === '/app/retail' ? retailPage(state,query) : current === '/app/intake' ? intakePage(state,query,notice) : current === '/app/tuition' ? familyTuitionPage(state,query) : current === '/app/classes' ? classesPage(state, query)
        : current === '/app/households' ? householdsPage(state) : current === '/app/household' ? householdPage(state)
        : current === '/app/profile' ? memberProfilePage(state) : current === '/app/substitutions' ? substitutionsPage(state,notice) : current === '/app/referrals' ? referralsPage(state) : (current === '/app/leads' || current === '/app/offers') ? leadsPage(state,query) : current === '/app/people' ? peoplePage(state, query)
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
  const handoff=notice.result?.result ?? notice.result;
  const billingHandoff=handoff?.actorId===state.actor.id && handoff?.status==='member_action_required' && handoff?.memberCommand?.startsWith('billing.') && handoff?.url?.startsWith('/signin?returnTo=%2Fapp%2Fpacks%23billing-') ? `<div class="panel" role="status"><div class="panel-body"><p>The member opens this link on their own device and signs in. No personal choice or payment has been made.</p><a href="${h(handoff.url)}">Open member personal step</a></div></div>` : '';
  const freezeHandoff=handoff?.status==='member_action_required' && handoff?.previewId && handoff?.url==='/signin?returnTo=%2Fapp%2Fpacks%23freezes' ? `<div class="panel" role="status"><div class="panel-body"><p>The member opens this link on their own device and signs in to review the exact dates and fee. No acceptance has been recorded.</p><a href="${h(handoff.url)}">${state.freezes?.ends.some((e: any)=>e.id===handoff.previewId) ? 'Open member resumption acceptance' : 'Open member freeze acceptance'}</a></div></div>` : '';
  const signingHandoff=handoff?.waiverId && handoff?.url?.startsWith('/intake/tablet/start?') ? `<div class="notice"><p>Open on a dedicated signed-out tablet within 15 minutes. Only this document is available.</p><a href="${h(handoff.url)}">Open private signing handoff</a></div>` : '';
  const paymentHandoff=state.actor.role==='member' && handoff?.type==='setup.start' && handoff?.status==='succeeded' && typeof handoff.launchURL==='string' && handoff.launchURL.startsWith('https://checkout.stripe.com/') ? `<div class="notice"><p>Your private test card setup is ready. Continue personally with Stripe; no payment will be collected.</p><a class="btn" rel="noreferrer" href="${h(handoff.launchURL)}">Continue to Stripe test card setup</a></div>` : '';
  const checkoutHandoff=state.actor.role==='owner' && handoff?.launchURL?.startsWith('https://checkout.stripe.com/') && handoff?.type!=='setup.start' ? `<div class="notice"><p>The private hosted test payment is ready. The payer completes it personally with Stripe.</p><a class="btn" rel="noreferrer" href="${h(handoff.launchURL)}">Continue to Stripe test payment</a></div>` : '';
  const widgetContinuation=state.widgetReturn ? `<div class="notice" role="status"><p>Selected class: ${h(state.widgetReturn.title)}. No seat is held; current booking rules still apply.</p><a href="${h(state.widgetReturn.url)}">Return to selected class</a></div>` : '';
  const notices = `${widgetContinuation}${billingHandoff}${freezeHandoff}${paymentHandoff}${checkoutHandoff}${signingHandoff}${bulkResult(notice)}${notice.error ? `<div class="notice error" data-app-notice tabindex="-1" role="alert">${h(notice.error)}</div>` : ''}${notice.message ? `<div class="notice" data-app-notice tabindex="-1" role="status">${h(notice.message)}</div>` : ''}`
  return new Response(shell(state, current, title, topBar(state, day, checkIn), content, notices), { status: allowed ? 200 : 403, headers: security })
}

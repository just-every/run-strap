// SEC-004: which doors need a second factor, and what holds a person who lacks one.
// Privileged doors: refunds and payouts (BILL-008, BILL-011 join this list before they ship), pay,
// every export and download, staff rights (agent keys, kiosks, finance users, factor resets) and provider
// connections (integration keys, member email). Owners and finance staff are held at those until they
// enroll; anyone with a working factor, covered or opted in, is held at every door until this session
// presents one. Agent keys and kiosks are credentials, never people, and never step up.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../domain'
import { selfService, standing } from './mfa'

const pages = new Set(['/app/recovery-diagnostics', '/app/revenue', '/app/teaching-pay', '/app/integrations', '/app/agent'])
const downloads = /\.(csv|xlsx|txt)$|^\/api\/strap\/(exit\.json|waiver-evidence\.(?:json|html)|preferences\.json|staff-history|teaching-pay|reports\/(?:revenue|finance))$/
export const privilegedRoute = (path: string) => pages.has(path) || path === '/api/strap/recovery-diagnostics' || downloads.test(path) || path.startsWith('/api/strap/tax') || path.startsWith('/api/strap/billing')
export const privilegedCommand = (name: string) => /^(privacy|staff|tax|agent|integration|kiosk|finance|manager|pay|member\.record)\./.test(name) || ['billing.connect','billing.disconnect','billing.checkout.start','billing.reconcile','billing.agreement.prepare','sms.test.connect', 'sms.test.send', 'attendance.booking.grant','appointment.booking.grant', 'intake.sensitive.grant', 'intake.form.publish', 'mfa.reset', 'mail.connect', 'person.invite', 'waiver.launch','waiver.tablet.launch','waiver.signing.grant','waiver.copy.mail.review'].includes(name)

/** What a finance user may open: the revenue and collections report, its downloads and their own security page. */
export const financeRoute = (path: string) => ['/app', '/app/revenue', '/app/security', '/api/strap/mfa', '/api/strap/reports/revenue', '/api/strap/reports/revenue.csv', '/api/strap/reports/revenue.xlsx'].includes(path)

/** What a manager may open: the revenue and attendance reports (their locations only), their downloads and their own security page. */
export const managerRoute = (path: string) => ['/app', '/app/revenue', '/app/reports', '/app/security', '/api/strap/mfa', '/api/strap/reports/revenue', '/api/strap/reports/revenue.csv', '/api/strap/reports/revenue.xlsx', '/api/strap/reports/attendance', '/api/strap/reports/attendance.csv', '/api/strap/reports/attendance.xlsx'].includes(path)
/** Staff who reach reports only. */
export const reportStaff = (who: Actor) => who.role === 'finance' || who.role === 'manager'

/** Keys no door may return until a covered person is cleared: pay, provider connections and staff access. */
export const privilegedState = ['privacy', 'teachingPay', 'payRules', 'integrations', 'agentKeys', 'kiosks', 'memberMail', 'smsTest']

export interface Hold { code: 'mfa_required' | 'mfa_enrollment_required'; reason: string | null }
const person = (who: Actor) => ['owner', 'finance', 'manager', 'front-desk', 'member', 'instructor'].includes(who.role) && !(who.role === 'owner' && !who.isOwner)

/** The hold on this request, or null when the door is open to this person. */
export async function mfaHold(env: Bindings, who: Actor, request: { path: string; name?: string; privileged: boolean }): Promise<Hold | null> {
  if (!person(who) || request.path === '/app/security' || request.path === '/api/strap/mfa' || (request.name && (selfService.includes(request.name) || request.name === 'session.signout'))) return null
  const s = await standing(env, who)
  if (s.usable.length && s.verifiedAt === null) return { code: 'mfa_required', reason: null }
  if (!s.usable.length && s.covered && request.privileged) return { code: 'mfa_enrollment_required', reason: s.reason }
  return null
}

/** Whether pay, provider and access data may be shown to this person now. */
export async function cleared(env: Bindings, who: Actor) {
  if (!person(who)) return true
  const s = await standing(env, who)
  return !s.covered || (s.usable.length > 0 && s.verifiedAt !== null)
}

/** The person editor also changes studio sign-in rights, independently of Base's operator routes. */
export async function staffRightsCommand(env: Bindings, name: string, input: Record<string, unknown>) {
  if (name !== 'person.save') return false
  const previous = input.id ? await env.DB.prepare('SELECT role,active FROM st_people WHERE id=?').bind(input.id).first<{ role: string; active: number }>() : null
  return previous
    ? (input.role !== undefined && input.role !== previous.role) || (input.active !== undefined && input.active !== !!previous.active)
    : input.role === 'instructor'
}

// The demo's commands all run at the moment the demo starts; its classes are then
// moved to their days. This gives every record the time a studio would have made
// it: each class week approved the Thursday evening before it starts, bookings in
// the days between that approval and the class, and each pack bought, approved and
// paid at the desk a few days before its member first booked with it.
import type { State, RecordData } from '../domain/types'
import { addDays, localDate, localInstant } from '../zone'

const minute = 60_000, day = 86_400_000
const evenings = ['19:21', '20:05', '18:47', '21:12', '19:38', '20:16', '18:58']
const desk = ['10:12', '17:48', '08:55', '12:31', '19:06', '07:42', '16:20', '11:37', '18:24']
const iso = (ms: number) => new Date(ms).toISOString()

export function stampHistory(state: State, zone: string, now: Date) {
  const all = [...state.records.values()], today = localDate(now, zone)
  const of = (kind: string) => all.filter(r => r.kind === kind).map(r => r.data)
  const at = (date: string, time: string) => Date.parse(localInstant(date, time, zone))
  // A planned time that has not happened yet falls back to yesterday at that hour.
  const happened = (ms: number, time: string) => ms < now.getTime() - minute ? ms : at(addDays(today, -1), time)
  const approvals = new Map(of('approval').map(a => [a.draftId, a]))
  const decide = (draft: RecordData, approvedAt: number, preparedFor: number) => {
    draft.createdAt = iso(approvedAt - preparedFor); draft.approvedAt = iso(approvedAt)
    const approval = approvals.get(draft.id); if (approval) approval.approvedAt = draft.approvedAt
  }

  // Class weeks: approved the Thursday evening before their Monday.
  const weekApproval = new Map<string, number>()
  of('draft').filter(d => d.type === 'classes' && d.status === 'approved').sort((a, b) => a.week.localeCompare(b.week)).forEach((d, i) => {
    const time = evenings[i % evenings.length], approvedAt = happened(at(addDays(d.week, -4), time), time)
    decide(d, approvedAt, (35 + i * 13 % 50) * minute)
    weekApproval.set(d.id, approvedAt)
  })
  const classes = new Map(of('class').map(c => [c.id, c]))
  for (const c of classes.values()) if (weekApproval.has(c.draftId)) c.publishedAt = iso(weekApproval.get(c.draftId)!)

  // Bookings: spread, in their original order, between the week's approval (or six
  // days before the class) and two hours before it starts.
  const bookings = of('booking'), fields = ['createdAt', 'bookedAt', 'cancelledAt']
  for (const c of classes.values()) {
    const own = bookings.filter(b => b.classId === c.id)
    const times = own.flatMap(b => fields.filter(f => b[f]).map(f => Date.parse(b[f])))
    if (!times.length) continue
    const start = Date.parse(c.start), first = Math.min(...times), last = Math.max(...times)
    const hi = Math.min(start - 2 * 60 * minute, now.getTime() - minute)
    let lo = Math.max((weekApproval.get(c.draftId) ?? hi - day) + 60 * minute, start - 6 * day)
    if (lo >= hi) lo = hi - minute
    const map = (ms: number) => Math.round(lo + (last === first ? 0 : (ms - first) / (last - first)) * (hi - lo))
    for (const b of own) for (const f of fields) if (b[f]) b[f] = iso(map(Date.parse(b[f])))
  }

  // Packs: bought at the desk up to twelve days before the member's first booking and
  // at least thirty days before the pack ends, approved as they pay, the payment
  // recorded a minute later and the waiver signed.
  const firstUse = (personId: string) => Math.min(...bookings.filter(b => b.personId === personId).map(b => Date.parse(b.createdAt)), Infinity)
  const purchases = new Map<string, number>()
  of('draft').filter(d => d.type === 'pack' && d.status === 'approved').forEach((d, i) => {
    const pack = of('pack').find(p => p.draftId === d.id)!, used = firstUse(d.personId)
    const planned = Number.isFinite(used) ? addDays(localDate(used, zone), -(1 + i * 5 % 12)) : addDays(today, -(3 + i * 7 % 23))
    const latest = addDays(localDate(pack.expiresAt, zone), -30)
    const bought = at(planned < latest ? planned : latest, desk[i % desk.length])
    decide(d, bought, (2 + i % 5) * minute)
    d.expiresAt = pack.expiresAt
    purchases.set(d.personId, bought)
    pack.createdAt = iso(bought)
    for (const charge of of('charge').filter(x => x.packId === pack.id)) charge.createdAt = iso(bought)
    for (const payment of of('payment').filter(x => x.personId === d.personId)) payment.createdAt = iso(bought + minute)
  })

  // The waiver: each member signs at their purchase (or the day before their first
  // booking); the studio published it two days before the first signature.
  const signed = of('acknowledgement').map(a => {
    const used = firstUse(a.personId)
    a.createdAt = iso(purchases.has(a.personId) ? purchases.get(a.personId)! + 3 * minute : Number.isFinite(used) ? used - day : at(addDays(today, -10), '18:10'))
    return Date.parse(a.createdAt)
  })
  const waiver = of('waiver')[0]
  if (waiver && signed.length) waiver.createdAt = iso(at(addDays(localDate(Math.min(...signed), zone), -2), '09:00'))

  // Work still waiting for approval: Mara's reminder from yesterday evening, the agent's drafts from later that night.
  const prepared: Record<string, string> = { reminder: '19:21', classes: '21:40', pack: '21:44' }
  for (const d of of('draft').filter(d => d.status === 'draft')) d.createdAt = iso(at(addDays(today, -1), prepared[d.type] ?? '20:00'))
}

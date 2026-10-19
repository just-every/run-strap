// Facts the screens read from the studio's records: who is in a class, which
// credit a member can use, what they owe, and who needs a follow-up. Each is
// derived from stored records only, by the same rules the domain applies.
import { packServiceEligible } from '../domain/pack-credits'
import { rows } from './shared'
import { dayOf } from './format'
import { roomOf } from '../domain/scheduling'

const now = () => Date.now()
const time = (value: unknown) => Date.parse(String(value))

export const classesOn = (s: any, date: string) => rows(s, 'classes').filter(c => dayOf(s, c.start) === date).sort((a, b) => a.start.localeCompare(b.start))
export const upcoming = (s: any) => rows(s, 'classes').filter(c => time(c.end) > now()).sort((a, b) => a.start.localeCompare(b.start))

export function attendance(s: any, classId: string) {
  const all = rows(s, 'bookings').filter(b => b.classId === classId)
  const booked = all.filter(b => b.status === 'booked').sort((a, b) => String(a.bookedAt ?? a.createdAt).localeCompare(String(b.bookedAt ?? b.createdAt)))
  const waiting = all.filter(b => b.status === 'waitlisted').sort((a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt))
  const cancelled = all.filter(b => b.status === 'cancelled')
  return { booked, waiting, cancelled, checkedIn: booked.filter(b => b.checkedInAt) }
}

/** The title before " · " is the class; after it, the room. */
export const classTitle = (c: any) => String(c.title).split(' · ')[0]
export const classRoom = (c: any) => roomOf(c)

/** The credit Strap would use to seat this member in this class (bookings.ts eligiblePack). */
export const eligiblePack = (s: any, personId: string, c: any) => rows(s, 'packs')
  .filter(p => p.personId === personId && packServiceEligible(p, c) && p.remaining > 0 && p.expiresAt > c.start && time(p.expiresAt) > now())
  .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0]
export const livePacks = (s: any, personId: string) => rows(s, 'packs').filter(p => p.personId === personId && p.remaining > 0 && time(p.expiresAt) > now())
export const balance = (s: any, personId: string) => rows(s, 'balances').find(b => b.personId === personId)?.balanceCents ?? 0
export const waiverSigned = (s: any, personId: string) => !s.waiver || rows(s, 'acknowledgements').some(a => a.personId === personId && a.waiverId === s.waiver.id)
export const lastVisit = (s: any, personId: string) => rows(s, 'bookings').filter(b => b.personId === personId && b.checkedInAt).map(b => b.checkedInAt).sort().at(-1)
export const packName = (p: any) => `${p.credits}-class pack`

/** The class that is on now, or the next to start today, or the day's last. */
export function currentClass(s: any, list: any[]) {
  return list.find(c => time(c.end) > now()) ?? list.at(-1)
}

/** A class with open spots and a waitlist that cannot move: the day's exception. */
export function stuckWaitlist(s: any, c: any) {
  if (time(c.start) <= now()) return null
  const { booked, waiting } = attendance(s, c.id), open = c.occupancy.onlineOpen
  if (open <= 0 || !waiting.length) return null
  return { open, first: waiting[0], reason: !waiverSigned(s, waiting[0].personId) ? 'waiver' : 'credit' }
}

export interface FollowUp { personId: string; name: string; kind: 'waiting' | 'owes' | 'lapsed' | 'expiring' | 'empty'; classId?: string }

/** Members who need a person's attention, most pressing first. */
export function followUps(s: any): FollowUp[] {
  const items: FollowUp[] = []
  const pendingReminder = new Set(rows(s, 'drafts').filter(d => d.type === 'reminder' && d.status === 'draft').map(d => d.personId))
  const pendingPack = new Set(rows(s, 'drafts').filter(d => d.type === 'pack' && d.status === 'draft').map(d => d.personId))
  for (const p of rows(s, 'people').filter(p => p.role === 'member' && p.active)) {
    const future = rows(s, 'bookings').filter(b => b.personId === p.id && b.status !== 'cancelled').map(b => ({ b, c: rows(s, 'classes').find(c => c.id === b.classId) })).filter(x => x.c && time(x.c.start) > now())
    const stuck = future.find(x => x.b.status === 'waitlisted' && !eligiblePack(s, p.id, x.c))
    const live = livePacks(s, p.id), owed = balance(s, p.id), last = lastVisit(s, p.id)
    if (stuck && !pendingPack.has(p.id)) items.push({ personId: p.id, name: p.name, kind: 'waiting', classId: stuck.c.id })
    else if (owed > 0 && !pendingReminder.has(p.id)) items.push({ personId: p.id, name: p.name, kind: 'owes' })
    else if (live.length && !future.length && last && now() - time(last) >= 14 * 86_400_000) items.push({ personId: p.id, name: p.name, kind: 'lapsed' })
    else if (live.some(pack => time(pack.expiresAt) - now() < 7 * 86_400_000) && !pendingPack.has(p.id)) items.push({ personId: p.id, name: p.name, kind: 'expiring' })
    else if (!live.length && !pendingPack.has(p.id)) items.push({ personId: p.id, name: p.name, kind: 'empty' })
  }
  const order = { lapsed: 0, waiting: 1, owes: 2, expiring: 3, empty: 4 }
  return items.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}

/** "Usually Tue and Thu 6:00 am": the weekdays and hour of a member's check-ins. */
export function habit(s: any, personId: string, clockOf: (value: unknown) => string) {
  const visits = rows(s, 'bookings').filter(b => b.personId === personId && b.checkedInAt).map(b => rows(s, 'classes').find(c => c.id === b.classId)).filter(Boolean)
  if (!visits.length) return ''
  const days = [...new Set(visits.map(c => new Intl.DateTimeFormat('en-US', { timeZone: s.studio?.timeZone ?? 'UTC', weekday: 'short' }).format(new Date(c.start))))]
  const hours = [...new Set(visits.map(c => clockOf(c.start)))]
  return `${visits.length === 1 ? 'Last came' : 'Usually'} ${days.slice(0, 2).join(' and ')} ${hours[0]}`
}

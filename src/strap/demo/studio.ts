import { Transaction } from '../domain/store'
import { savePerson } from '../domain/people'
import { prepareClasses, publishClasses } from '../domain/classes'
import { preparePack, approvePack, recordPayment, prepareReminder } from '../domain/money'
import { publishWaiver, acknowledgeWaiver, book, checkin } from '../domain/bookings'
import type { Actor, State, Person } from '../domain/types'
import { memberNames, timetable } from './timetable'

const day = 86_400_000

export async function buildStudio(db: D1Database, operator: State['operator'], now: Date) {
  const state: State = { version: 1, people: [], records: new Map(), operator }
  const owner: Actor = { id: operator.id, email: operator.email, role: 'owner', isOwner: true }
  // Run the real domain functions in their normal order, retaining their records
  // in memory, then atomically persist them with fixed IDs. No network or effects.
  const run = async (fn: Function, input: object, who = owner) => {
    const result = await fn(new Transaction(db, state, who), input)
    state.version++
    return result
  }
  const instructors: Person[] = []
  for (const name of ['Priya Shah', 'Taylor Brooks', 'Morgan Lee']) {
    const p = await run(savePerson, { name, email: email(name), role: 'instructor', active: true })
    state.people.push(p); instructors.push(p)
  }
  const members: Person[] = []
  for (const name of memberNames) {
    const p = await run(savePerson, { name, email: email(name), role: 'member', active: true })
    state.people.push(p); members.push(p)
  }
  const waiver = await run(publishWaiver, { text: 'Please let your instructor know about injuries, work within your comfort level and ask for help with equipment. I acknowledge the studio safety briefing.' })
  const memberActor = (p: any): Actor => ({ id: p.id, email: p.email, role: 'member', personId: p.id, isOwner: false })
  // Class packs are the product's current membership entitlement. Include intro,
  // five-class and ten-class passes, part-paid balances and upcoming expiries.
  for (const [i, p] of members.entries()) {
    const credits = i < 3 ? 3 : i >= 18 ? 5 : 10
    const amountCents = credits === 3 ? 3900 : credits === 5 ? 11000 : 20000
    const draft = await run(preparePack, { personId: p.id, credits, amountCents, expiresAt: new Date(now.getTime() + 60 * day).toISOString() })
    await run(approvePack, { id: draft.id })
    if (i % 5 !== 0) await run(recordPayment, { personId: p.id, amountCents: i % 7 === 0 ? amountCents / 2 : amountCents, reference: `STUDIO-${2100 + i}` })
    await run(acknowledgeWaiver, { id: waiver.id }, memberActor(p))
  }
  const monday = new Date(now)
  monday.setUTCHours(0, 0, 0, 0)
  monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7 + (monday.getUTCDay() === 1 ? 7 : 0))
  // Historical attendance is replayed while the occurrences are still future,
  // then moved back two weeks as a unit. The domain's live clock is never changed.
  for (const history of [false, true]) {
    const start = new Date(monday.getTime() + (history ? 7 : 0) * day)
    const entries = timetable(start, instructors, history)
    const draft = await run(prepareClasses, { week: start.toISOString().slice(0, 10), classes: entries })
    const published = await run(publishClasses, { id: draft.id })
    for (const [index, entry] of published.classes.entries()) {
      const attendees = history ? members.slice(13 + index, 17 + index) : index === 0 ? members.slice(3, 13) : members.slice(3 + index % 9, 6 + index % 9)
      for (const p of attendees) {
        const booking = await run(book, { classId: entry.id }, memberActor(p))
        if (history && booking.status === 'booked') {
          await run(checkin, { id: booking.id })
          state.records.get(booking.id)!.data.checkedInAt = new Date(Date.parse(entry.start) + 5 * 60_000).toISOString()
        }
      }
    }
    if (history) {
      const ids = new Set(published.classes.map((c: any) => c.id))
      for (const row of state.records.values()) {
        if (row.data.id === draft.id || ids.has(row.data.id) || ids.has(row.data.classId)) row.data = shift(row.data, -14 * day)
      }
    }
  }
  // Inactive access is Strap's current pause mechanism; no invented subscription
  // state. An expired pass shows the renewal work to do.
  for (const index of [22, 23]) {
    const p = members[index]
    const saved = await run(savePerson, { ...p, active: false })
    Object.assign(p, saved)
  }
  const expiring = [...state.records.values()].find(r => r.kind === 'pack' && r.data.personId === members[0].id)!
  expiring.data.expiresAt = new Date(now.getTime() + 4 * day).toISOString()
  const expired = [...state.records.values()].find(r => r.kind === 'pack' && r.data.personId === members[23].id)!
  expired.data.expiresAt = new Date(now.getTime() - 2 * day).toISOString()
  // Leave real work waiting for the owner: one pack and one balance reminder.
  await run(preparePack, { personId: members[0].id, credits: 10, amountCents: 20000, expiresAt: new Date(now.getTime() + 90 * day).toISOString() })
  await run(prepareReminder, { personId: members[5].id })

  const fixed = new Map<string, string>()
  state.people.forEach((p, i) => fixed.set(p.id, `demo-person-${i + 1}`))
  let n = 0
  for (const r of state.records.values()) fixed.set(r.data.id, `demo-${r.kind}-${++n}`)
  const remap = (value: any): any => typeof value === 'string' ? fixed.get(value) ?? value : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)])) : value
  // Reminder basis is a serialized source fence; regenerate it after fixed IDs.
  const people = remap(state.people), records = remap([...state.records.values()])
  for (const r of records) if (r.kind === 'draft' && r.data.type === 'reminder') {
    const p = people.find((p: any) => p.id === r.data.personId)
    const rows = (kind: string) => records.filter((r: any) => r.kind === kind && r.data.personId === p.id).map((r: any) => r.data)
    r.data.basis = JSON.stringify({ personVersion: p.version, email: p.email, name: p.name, charges: rows('charge').map((r: any) => [r.id, r.amountCents]), payments: rows('payment').map((r: any) => [r.id, r.amountCents, r.reference]) })
  }
  return { people, records, version: state.version }
}
const email = (name: string) => name.toLowerCase().replaceAll(' ', '.') + '@studio.example'
function shift(value: any, offset: number): any {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d(?:T|$)/.test(value)) {
    const at = new Date(Date.parse(value) + offset).toISOString()
    return value.length === 10 ? at.slice(0, 10) : at
  }
  return Array.isArray(value) ? value.map(v => shift(v, offset)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, offset)])) : value
}

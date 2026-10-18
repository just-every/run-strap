import { Transaction } from '../domain/store'
import { savePerson } from '../domain/people'
import { prepareClasses, publishClasses } from '../domain/classes'
import { preparePack, approvePack, recordPayment, prepareReminder } from '../domain/money'
import { publishWaiver, acknowledgeWaiver, book, cancel, checkin } from '../domain/bookings'
import { saveStudio } from '../domain/studio'
import type { Actor, State, Person, RecordData } from '../domain/types'
import { addDays, localDate, localInstant, mondayOf } from '../zone'
import { inactive, instructorNames, memberPacks, studio, today, week, type Slot } from './timetable'

const day = 86_400_000

export async function buildStudio(db: D1Database, operator: State['operator'], now: Date) {
  const state: State = { version: 1, people: [], records: new Map(), operator }
  const owner: Actor = { id: operator.id, email: operator.email, role: 'owner', isOwner: true }
  const agent: Actor = { ...owner, role: 'agent' }
  // Run the real domain functions in their normal order, retaining their records
  // in memory, then atomically persist them with fixed IDs. No network or effects.
  const run = async (fn: Function, input: object, who = owner) => {
    const result = await fn(new Transaction(db, state, who), input)
    state.version++
    return result
  }
  const zone = studio.timeZone, date = localDate(now, zone)
  await run(saveStudio, studio)
  const instructors: Person[] = []
  for (const name of instructorNames) {
    const p = await run(savePerson, { name, email: email(name), role: 'instructor', active: true })
    state.people.push(p); instructors.push(p)
  }
  const members = new Map<string, Person>()
  for (const [name] of memberPacks) {
    const p = await run(savePerson, { name, email: email(name), role: 'member', active: true })
    state.people.push(p); members.set(name, p)
  }
  const member = (name: string) => members.get(name)!
  const waiver = await run(publishWaiver, { text: 'Please tell your instructor about any injury before class, work within your comfort level and ask for help with the reformer springs and straps. I have read the studio safety briefing.' })
  const memberActor = (p: Person): Actor => ({ id: p.id, email: p.email!, role: 'member', personId: p.id, isOwner: false })
  for (const [index, [name, credits, amountCents, paid]] of memberPacks.entries()) {
    const p = member(name)
    if (credits) {
      const draft = await run(preparePack, { personId: p.id, credits, amountCents, expiresAt: new Date(now.getTime() + 75 * day).toISOString() })
      await run(approvePack, { id: draft.id })
      if (paid) await run(recordPayment, { personId: p.id, amountCents: paid, reference: `SQ-${4810 + index}` })
    }
    await run(acknowledgeWaiver, { id: waiver.id }, memberActor(p))
  }

  // Publish one day's slots through a week draft. A past day is published on a
  // future date with the same weekday, booked there, then moved back as a unit
  // (on the studio's wall clock); the domain's live clock never changes.
  const publish = async (days: [string, Slot[]][]) => {
    const classes = days.flatMap(([on, slots]) => slots.map(s => {
      const start = localInstant(on, s.time, zone)
      return { title: `${s.title} · ${s.room}`, start, end: new Date(Date.parse(start) + s.minutes * 60_000).toISOString(), capacity: s.capacity, instructorId: instructors[s.instructor].id }
    }))
    const draft = await run(prepareClasses, { week: mondayOf(days[0][0]), classes })
    return { draft, published: (await run(publishClasses, { id: draft.id })).classes as RecordData[] }
  }
  const relocate = (ids: Set<string>, from: string, to: string) => {
    const offset = Date.parse(localInstant(to, '12:00', zone)) - Date.parse(localInstant(from, '12:00', zone))
    for (const row of state.records.values()) if (ids.has(row.data.id) || ids.has(row.data.classId)) row.data = shift(row.data, offset, Math.round(offset / day))
  }
  const arrive = async (bookingId: string, start: string, minutesEarly: number) => {
    await run(checkin, { id: bookingId })
    state.records.get(bookingId)!.data.checkedInAt = new Date(Date.parse(start) - minutesEarly * 60_000).toISOString()
  }

  // History: Ana's Tuesday and Thursday 6 am classes, her last three weeks ago,
  // and the regulars' visits over the last two weeks.
  const before = (weekday: number, daysAgo: number) => { let d = addDays(date, -daysAgo); while (new Date(d + 'T12:00:00Z').getUTCDay() !== weekday) d = addDays(d, -1); return d }
  for (const [past, slot, names] of [
    [before(2, 28), week[1][0], ['Ana Patel', 'Alicia Stone', 'Sam Reyes', 'Megan Kerr', 'Rachel Moss']],
    [before(4, 21), week[3][0], ['Ana Patel', 'Lucia Cruz', 'Nora Price', 'Jess Alvarez']],
    [before(2, 14), week[1][1], ['Grace Liu', 'Hannah Brooks', 'Olivia Grant', 'Priya Desai', 'Lena Ortiz']],
    [before(4, 7), week[3][3], ['Nora Price', 'Jasmine Hart', 'Diane Lowry', 'Ruth Adler', 'Ivy Chen', 'Paige Turner']],
  ] as [string, Slot, string[]][]) {
    const future = addDays(past, 42)
    const { draft, published } = await publish([[future, [slot]]])
    for (const name of names) {
      const booking = await run(book, { classId: published[0].id }, memberActor(member(name)))
      await arrive(booking.id, published[0].start, 4 + name.length % 7)
    }
    relocate(new Set([draft.id, ...published.map(c => c.id)]), future, past)
  }

  // Today, as the front desk sees it at this hour: who came, who waits, who cancelled.
  {
    const future = addDays(date, 70)
    const { draft, published } = await publish([[future, today.map(t => t.slot)]])
    const started: boolean[] = []
    for (const [index, plan] of today.entries()) {
      const entry = published[index], bookings = new Map<string, RecordData>()
      for (const name of [...plan.booked, ...plan.waitlist ?? []]) bookings.set(name, await run(book, { classId: entry.id }, memberActor(member(name))))
      for (const name of plan.cancel ?? []) await run(cancel, { id: bookings.get(name)!.id }, memberActor(member(name)))
      started[index] = Date.parse(localInstant(date, plan.slot.time, zone)) <= now.getTime()
      // Everyone booked into a class that has begun checked in, except one no-show at 9:30.
      if (started[index]) for (const [name, b] of bookings) {
        const current = state.records.get(b.id)!.data
        if (current.status === 'booked' && name !== 'Chris Lee') await arrive(b.id, entry.start, 2 + name.length % 9)
      }
    }
    relocate(new Set([draft.id, ...published.map(c => c.id)]), future, date)
  }

  // The days ahead: the week's pattern from tomorrow, a few members on each.
  const regulars = memberPacks.filter(([name, credits]) => credits >= 20 && !inactive.includes(name)).map(([name]) => member(name))
  let next = 0
  const ahead = Array.from({ length: 6 }, (_, i) => addDays(date, i + 1))
  for (const monday of [...new Set(ahead.map(mondayOf))]) {
    const days = ahead.filter(on => mondayOf(on) === monday).map(on => [on, week[(new Date(on + 'T12:00:00Z').getUTCDay() + 6) % 7]] as [string, Slot[]])
    const { published } = await publish(days)
    for (const [index, entry] of published.entries()) {
      for (let k = 0; k < 3 + index % 4; k++) await run(book, { classId: entry.id }, memberActor(regulars[next++ % regulars.length]))
    }
  }

  for (const name of inactive) {
    const p = member(name), saved = await run(savePerson, { ...p, active: false })
    Object.assign(p, saved)
  }
  const pack = (name: string) => [...state.records.values()].find(r => r.kind === 'pack' && r.data.personId === member(name).id)!
  pack('Jordan Park').data.expiresAt = new Date(Date.parse(localInstant(addDays(date, 3), '23:59', zone)) + 59_000).toISOString()
  pack('Shay Mitchell').data.expiresAt = new Date(now.getTime() - 2 * day).toISOString()

  // Work waiting for Mara: a renewal pack and a class week from the studio's
  // agent, and a balance reminder she started herself.
  await run(preparePack, { personId: member('Jordan Park').id, credits: 10, amountCents: 18900, expiresAt: new Date(Date.parse(localInstant(addDays(date, 93), '23:59', zone)) + 59_000).toISOString() }, agent)
  await run(prepareReminder, { personId: member('Taylor Kim').id })
  {
    const monday = addDays(mondayOf(date), 14)
    const classes = week[0].map(s => {
      const start = localInstant(monday, s.time, zone)
      return { title: `${s.title} · ${s.room}`, start, end: new Date(Date.parse(start) + s.minutes * 60_000).toISOString(), capacity: s.capacity, instructorId: instructors[s.instructor].id }
    })
    await run(prepareClasses, { week: monday, classes }, agent)
  }

  const fixed = new Map<string, string>()
  state.people.forEach((p, i) => fixed.set(p.id, `demo-person-${i + 1}`))
  let n = 0
  for (const r of state.records.values()) if (r.kind !== 'studio') fixed.set(r.data.id, `demo-${r.kind}-${++n}`)
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
/** Every instant moves by `offset` ms and every civil date by `days`. */
function shift(value: any, offset: number, days: number): any {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)) return addDays(value, days)
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) return new Date(Date.parse(value) + offset).toISOString()
  return Array.isArray(value) ? value.map(v => shift(v, offset, days)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, offset, days)])) : value
}

// Browser forms speak the studio's language: dollars, calendar dates and wall
// times in the studio's zone, an instructor picked by name. This turns one
// posted form into the same command input the JSON API takes.
import { fail } from './credentials'
import { addDays, localInstant } from './zone'

const date = /^\d{4}-\d\d-\d\d$/, clock = /^\d\d:\d\d$/

/** "$1,234.50", "180" or "180.5" → whole cents. */
export function cents(value: unknown, label: string) {
  const text = String(value ?? '').trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) fail(`Enter ${label} in dollars, such as 180.00`)
  const [whole, part = ''] = text.split('.')
  return Number(whole) * 100 + Number(part.padEnd(2, '0'))
}

function zoneOf(timeZone: string | undefined) {
  if (!timeZone) fail('Set your studio’s time zone in Studio settings first')
  return timeZone!
}

/** One class row of the week editor: day of the week, start time, length, title, room, spots and instructor. */
function classRow(input: Record<string, unknown>, i: number, week: string, timeZone: string) {
  const get = (key: string) => String(input[`c${i}_${key}`] ?? '').trim()
  if (!get('title')) return null
  const day = Number(get('day')), minutes = Number(get('minutes'))
  if (!Number.isInteger(day) || day < 0 || day > 6) fail(`Choose a day for class ${i + 1}`)
  if (!clock.test(get('time'))) fail(`Choose a start time for class ${i + 1}`)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) fail(`Enter a length in minutes for class ${i + 1}`)
  const start = localInstant(addDays(week, day), get('time'), timeZone)
  return {
    title: get('title'), service: get('service') || get('title'), room: get('room'), equipment: get('equipment').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    bufferBeforeMinutes: Number(get('bufferBeforeMinutes')), bufferAfterMinutes: Number(get('bufferAfterMinutes')),
    start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
    capacity: Number(get('capacity')), ...(get('onlineCapacity') ? { onlineCapacity: Number(get('onlineCapacity')) } : {}), instructorId: get('instructorId'),
  }
}

export function formInput(name: string, raw: Record<string, unknown>, timeZone: string | undefined): Record<string, unknown> {
  const input = { ...raw }
  if (name === 'reminder.rule.save') { input.enabled = input.enabled === 'true'; input.leadMinutes = Number(input.leadMinutes) }
  if (name === 'mail.preference.save') input.optedOut = input.optedOut === 'true'
  if (name==='substitution.qualification.save') input.qualified=input.qualified==='true'
  if (name==='plan.change.prepare') {
    for (const key of ['planRequestId','exceptionReason']) if (input[key]==='') delete input[key]
    if (input.mode==='now') {
      if (!date.test(String(input.effectiveDate)) || !clock.test(String(input.effectiveTime))) fail('Choose the effective date and time')
      input.effectiveAt=localInstant(String(input.effectiveDate),String(input.effectiveTime),zoneOf(timeZone)); delete input.expiresOn
    }
    delete input.effectiveDate; delete input.effectiveTime
  }
  if (name.startsWith('lead.')) {
    if ('version' in input) input.version=Number(input.version)
    if (input.dueAt) input.dueAt=String(input.dueAt)+'Z'
    for (const key of ['bookingId','externalMembershipReference','lostReason','note']) if (input[key]==='') delete input[key]
    if (name==='lead.update') {
      if (!['intro-booked','first-visit'].includes(String(input.stage))) delete input.bookingId
      if (input.stage!=='membership') delete input.externalMembershipReference
      if (input.stage!=='lost') delete input.lostReason
    }
  }
  if (name.startsWith('recognition.')) {
    for (const key of ['threshold','version']) if (key in input) input[key]=Number(input[key])
    for (const key of ['enabled','optedIn']) if (key in input) input[key]=input[key]==='true'
  }
  if (name === 'pay.rule.save') {
    const mode = String(input.mode), cancellation = {treatment:String(input.cancellation),...(input.cancellation === 'flat' ? {amountCents:cents(input.cancellationAmount,'canceled-class pay')} : {})}
    const rate = mode === 'tiered' ? {tiers:String(input.tiers ?? '').split(/\r?\n/).filter(line=>line.trim()).map(line=>{const [limit,amount,...extra]=line.split(',');if(extra.length || !amount) fail('Enter one inclusive limit and USD amount per tier'); return {upTo:limit.trim()==='*'?null:Number(limit.trim()),rateCents:cents(amount,'the tier rate')}})} : {rateCents:cents(input.rate,'the teaching rate')}
    return {instructorId:input.instructorId,service:input.service,effectiveAt:String(input.effectiveAt)+'Z',mode,...rate,minimumCents:cents(input.minimum,'the guaranteed minimum'),cancellation,...(String(input.substituteRate ?? '').trim() ? {substitute:{mode:'flat-class',rateCents:cents(input.substituteRate,'the substitute rate'),minimumCents:0}} : {})}
  }
  if (name === 'pay.adjust') {
    const amount=String(input.adjustment ?? '').trim(), negative=amount.startsWith('-')
    return {...input,amountCents:cents(negative?amount.slice(1):amount,'the teaching-pay adjustment')*(negative?-1:1)}
  }
  if (name === 'booking.bulk.cancel') input.ids = Object.keys(input).filter(key => key.startsWith('b_') && input[key] === 'true').map(key => key.slice(2))
  if (name === 'booking.waitlist.position') input.position = Number(input.position)
  if (name === 'cancellationReasons.save') input.reasons = String(input.reasons ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if ('suppressNotice' in input) input.suppressNotice = input.suppressNotice === 'true'
  if ('credits' in input) input.credits = Number(input.credits)
  if ('creditsDelta' in input) input.creditsDelta = Number(input.creditsDelta)
  if ('revision' in input) input.revision = Number(input.revision)
  if (typeof input.eligibleServices === 'string') input.eligibleServices = input.eligibleServices.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if ('active' in input) input.active = ['on', 'true', '1'].includes(String(input.active))
  if (name === 'booking.desk' && String(input.amount ?? '').trim() === '') delete input.amount
  if (name === 'booking.desk' && !['sell-pack'].includes(String(input.pay))) { delete input.expiresOn; delete input.credits }
  if (name === 'booking.desk' && String(input.pay) !== 'pack') delete input.packId
  if ('amount' in input) { input.amountCents = cents(input.amount, name === 'payment.record' ? 'the amount received' : 'the pack price'); delete input.amount }
  if ('expiresOn' in input) {
    if (!date.test(String(input.expiresOn))) fail('Choose the last day the pack can be used')
    // Inclusive local Good through date; the next midnight is the exclusive boundary.
    input.expiresAt = localInstant(addDays(String(input.expiresOn), 1), '00:00', zoneOf(timeZone))
    delete input.expiresOn
  }
  if (name === 'pack.adjust') {
    if (input.expiresDate || input.expiresTime) {
      const time = String(input.expiresTime)
      if (!date.test(String(input.expiresDate)) || !/^\d\d:\d\d(?::\d\d)?$/.test(time)) fail('Choose both an expiration date and time')
      const seconds = Number(time.split(':')[2] ?? 0)
      if (seconds > 59) fail('Choose a valid expiration time')
      input.expiresAt = new Date(Date.parse(localInstant(String(input.expiresDate), time.slice(0, 5), zoneOf(timeZone))) + seconds * 1000).toISOString()
    }
    delete input.expiresDate; delete input.expiresTime
  }
  if (name === 'spots.save') {
    const lines = (key: string) => String(input[key] ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    return { room: String(input.room ?? '').trim(), spots: lines('spots'), disabled: lines('disabled') }
  }
  if (name === 'waitlist.save') input.claimMinutes = Number(input.claimMinutes)
  if (name === 'booking.desk') input.waitlist = input.waitlist === 'true'
  if (name === 'pack.prepare') input.priorityBooking = ['on', 'true', '1'].includes(String(input.priorityBooking))
  if (name === 'bookingRule.save') {
    const whole = (key: string) => { const value = String(input[key] ?? '').trim(); return value === '' ? null : Number(value) }
    return { service: String(input.service ?? '').trim(), opensHoursBefore: whole('opensHoursBefore'), priorityOpensHoursBefore: whole('priorityOpensHoursBefore'),
      noShowGraceMinutes: whole('noShowGraceMinutes') ?? 0, closesMinutesBefore: whole('closesMinutesBefore') ?? 0, cancelCutoffHours: whole('cancelCutoffHours') ?? 0,
      lateCancelReturnsCredit: input.lateCancelReturnsCredit === 'true', lateCancelFeeCents: cents(input.lateFee ?? '0', 'the late-cancel fee'), noShowFeeCents: cents(input.noShowFee ?? '0', 'the no-show fee') }
  }
  if (name === 'series.prepare' || name === 'series.change.prepare') {
    const values: Record<string, unknown> = { ...input }
    for (const key of ['minutes', 'capacity', 'onlineCapacity', 'intervalWeeks', 'bufferBeforeMinutes', 'bufferAfterMinutes']) if (key in values) values[key] = Number(values[key])
    values.equipment = String(values.equipment ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    if (name === 'series.prepare') return values
    const { classId, scope, reason, ...change } = values
    return { classId, scope, reason, change }
  }
  if (name === 'classes.prepare') {
    const week = String(input.week ?? ''), zone = zoneOf(timeZone)
    if (!date.test(week)) fail('Choose the Monday that starts the week')
    const rows = Number(input.rows)
    const classes = Array.from({ length: Number.isInteger(rows) && rows > 0 && rows <= 100 ? rows : 0 }, (_, i) => classRow(input, i, week, zone)).filter(Boolean)
    if (!classes.length) fail('Add at least one class to the week')
    return { week, classes }
  }
  if (name === 'closure.prepare' && input.scope !== 'class') {
    const zone = zoneOf(timeZone)
    if (!date.test(String(input.startDate)) || !clock.test(String(input.startTime)) || !date.test(String(input.endDate)) || !clock.test(String(input.endTime))) fail('Choose when the closure starts and ends')
    return { scope: input.scope, room: input.room, reason: input.reason, start: localInstant(String(input.startDate), String(input.startTime), zone), end: localInstant(String(input.endDate), String(input.endTime), zone) }
  }
  if (name === 'scheduling.unavailable.save') {
    const zone = zoneOf(timeZone)
    return { ...input, resourceId: input.resourceKind === 'instructor' ? input.instructorId : input.resourceId,
      start: localInstant(String(input.startDate), String(input.startTime), zone),
      end: localInstant(String(input.endDate), String(input.endTime), zone) }
  }
  return input
}

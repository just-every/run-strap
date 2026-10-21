// API-003: the outcome-level attendance:read resource for keys created with a member-reference
// key. One row per seat that holds, held or lost a booked place; never reasons, notes, health,
// money, contact details, kiosk ids, instructor names or person ids.
import { shortName, type Person, type RecordData } from './domain/types'

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
/** `mref_` + the first 128 bits of HMAC-SHA-256(key's own random secret, person id). */
export async function memberRefs(refKey: string, people: Person[]) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(refKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Map(await Promise.all(people.map(async p => [p.id, 'mref_' + hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p.id))).slice(0, 32)] as const)))
}
export const newRefKey = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer)

/** booked until the seat is checked in, marked no-show or excused; a cancelled seat is a late or
 * early cancel. Waitlisted and offered places, and cancellations that are not a late/early
 * choice (moves, expired offers, studio-cancelled classes), have no outcome and are omitted. */
export function outcomeOf(b: RecordData): string | null {
  if (b.status === 'booked') return ['attended', 'no_show', 'excused'].includes(b.attendance) ? b.attendance : 'booked'
  if (b.status === 'cancelled') return b.cancellation === 'late' ? 'late_cancel' : b.cancellation === 'early' ? 'early_cancel' : null
  return null
}
const canceller = (role: unknown) => role === 'member' ? 'member' : role === 'owner' ? 'staff' : role === 'system' ? 'system' : null

export function attendanceRows(bookings: RecordData[], people: Map<string, Person>, refs: Map<string, string>) {
  return bookings.flatMap(b => {
    const outcome = outcomeOf(b), who = people.get(b.personId)
    if (!outcome || !who) return []
    const fix = b.corrections?.at(-1), checked = !!b.checkinChannel
    return [{
      bookingId: b.id, memberRef: refs.get(b.personId)!, attendee: shortName(who.name), outcome,
      // An owner correction to attended is not a check-in: it has no check-in time or channel.
      checkedInAt: checked ? b.checkedInAt ?? null : null, checkInChannel: checked ? b.checkinChannel : null,
      cancelledAt: b.status === 'cancelled' ? b.cancelledAt ?? null : null, cancelledBy: b.status === 'cancelled' ? canceller(b.cancelledByRole) : null,
      corrected: !!fix, correctedFrom: fix?.from ?? null, correctedAt: fix?.at ?? null,
      source: b.source === 'imported' ? 'imported' : 'native',
    }]
  })
}

// A studio's wall clock. Instants are stored in UTC; people read and enter
// them in the studio's IANA time zone, the US way ("Tue, Oct 20 · 6:00 am").

const parts = (at: Date, timeZone: string) => {
  const out: Record<string, number> = {}
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

/** Minutes the zone is ahead of UTC at that instant (Chicago in October: -300). */
export function offsetMinutes(at: Date, timeZone: string) {
  const p = parts(at, timeZone)
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime()) / 60_000)
}

const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
const offsetText = (minutes: number) => `${minutes < 0 ? '-' : '+'}${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`

/** A civil date and wall time in the zone as an ISO instant carrying its offset: "2026-10-20T06:00:00-05:00". */
export function localInstant(date: string, time: string, timeZone: string) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  let offset = offsetMinutes(new Date(wall), timeZone)
  offset = offsetMinutes(new Date(wall - offset * 60_000), timeZone)
  return `${date}T${pad(hh)}:${pad(mm)}:00${offsetText(offset)}`
}

/** The zone's civil date of an instant: "2026-10-20". */
export function localDate(at: Date | string | number, timeZone: string) {
  const p = parts(new Date(at), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Days after a civil date, as a civil date. */
export const addDays = (date: string, days: number) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10)

/** The Monday on or before a civil date. */
export const mondayOf = (date: string) => addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7))

export const isZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(value)) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true } catch { return false }
}

/** The US zones a studio chooses from, with the names owners know them by. */
export const usZones: [string, string][] = [
  ['America/New_York', 'Eastern (New York)'],
  ['America/Chicago', 'Central (Chicago, Nashville)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Mountain, no daylight saving (Phoenix)'],
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
  ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'],
]

/** "Central time" for America/Chicago; other zones by their IANA name. */
export const zoneName = (zone: string) => { const known = usZones.find(([id]) => id === zone)?.[1]; return known ? `${known.split(' ')[0].replace(',', '')} time` : zone.replace(/_/g, ' ') }

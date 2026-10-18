// How the app writes times, dates and money: the US way, on the studio's clock.
// Before the owner sets the studio's time zone, times show in UTC and say so.
import { h } from './shared'
import { localDate } from '../zone'

export const zoneOf = (s: any): string | undefined => s.studio?.timeZone
const formats = new Map<string, Intl.DateTimeFormat>()
const format = (s: any, options: Intl.DateTimeFormatOptions) => {
  const timeZone = zoneOf(s) ?? 'UTC', key = timeZone + JSON.stringify(options)
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat('en-US', { timeZone, ...options }))
  return formats.get(key)!
}
const utc = (s: any) => zoneOf(s) ? '' : ' UTC'
const at = (value: unknown) => new Date(typeof value === 'number' ? value : String(value))
const civil = (date: string) => new Date(date + 'T12:00:00Z')
const civilFormat = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options })
const longDay = civilFormat({ weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
const shortDay = civilFormat({ weekday: 'short', month: 'short', day: 'numeric' })
const shortDayYear = civilFormat({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const plainDate = civilFormat({ month: 'short', day: 'numeric', year: 'numeric' })

/** Today's date in the studio. */
export const studioToday = (s: any) => localDate(Date.now(), zoneOf(s) ?? 'UTC')
/** The studio's civil date of an instant. */
export const dayOf = (s: any, value: unknown) => localDate(at(value), zoneOf(s) ?? 'UTC')
/** "6:00 am" */
export const clock = (s: any, value: unknown) => format(s, { hour: 'numeric', minute: '2-digit' }).format(at(value)).replace(' AM', ' am').replace(' PM', ' pm') + utc(s)
/** "Tuesday, Oct 20, 2026" for a civil date. */
export const dayLong = (date: string) => longDay.format(civil(date))
/** "Tue, Oct 20", with the year when it is not this year. */
export const dayShort = (s: any, date: string) => (date.slice(0, 4) === studioToday(s).slice(0, 4) ? shortDay : shortDayYear).format(civil(date))
/** "Oct 20, 2026" */
export const datePlain = (date: string) => plainDate.format(civil(date))
/** "Today 9:14 am", "Yesterday 7:21 pm" or "Tue, Oct 20 · 6:00 am". */
export function when(s: any, value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  const instant = at(value), date = dayOf(s, instant), today = studioToday(s)
  const yesterday = localDate(Date.parse(today + 'T12:00:00Z') - 86_400_000, 'UTC')
  const label = date === today ? 'Today' : date === yesterday ? 'Yesterday' : dayShort(s, date) + ' ·'
  return `<time datetime="${h(instant.toISOString())}">${h(label)} ${h(clock(s, instant))}</time>`
}
/** Minutes between two instants: "50 min". */
export const length = (start: unknown, end: unknown) => `${Math.round((Date.parse(String(end)) - Date.parse(String(start))) / 60_000)} min`

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
/** Whole cents as US dollars: 18900 → "$189.00". */
export const money = (cents: unknown) => usd.format(Number(cents ?? 0) / 100)

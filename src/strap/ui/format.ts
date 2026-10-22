// How the app writes times, dates and money: the US way, on the studio's clock.
// Before the owner sets the studio's time zone, times show in UTC and say so.
import { h } from './shared'
import { localDate } from '../zone'

export const zoneOf = (s: any): string | undefined => s.studio?.timeZone
const formats = new Map<string, Intl.DateTimeFormat>()
// A class is read on its own location's clock (STUDIO-001/002): pass that zone as `zone`; everything else uses the studio's.
const format = (s: any, options: Intl.DateTimeFormatOptions, zone?: string) => {
  const timeZone = zone ?? zoneOf(s) ?? 'UTC', key = timeZone + JSON.stringify(options)
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat('en-US', { timeZone, ...options }))
  return formats.get(key)!
}
const utc = (s: any, zone?: string) => zone || zoneOf(s) ? '' : ' UTC'
/** "PDT": added after a time on another location's clock, so two locations' times are never mistaken for each other. */
const away = (s: any, value: unknown, zone?: string) => zone && zoneOf(s) && zone !== zoneOf(s) ? ' ' + (new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(at(value)).find(p => p.type === 'timeZoneName')?.value ?? zone) : ''
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
export const dayOf = (s: any, value: unknown, zone?: string) => localDate(at(value), zone ?? zoneOf(s) ?? 'UTC')
/** "6:00 am" */
export const clock = (s: any, value: unknown, zone?: string) => format(s, { hour: 'numeric', minute: '2-digit' }, zone).format(at(value)).replace(' AM', ' am').replace(' PM', ' pm') + utc(s, zone) + away(s, value, zone)
/** "Tuesday, Oct 20, 2026" for a civil date. */
export const dayLong = (date: string) => longDay.format(civil(date))
/** "Tue, Oct 20", with the year when it is not this year. */
export const dayShort = (s: any, date: string) => (date.slice(0, 4) === studioToday(s).slice(0, 4) ? shortDay : shortDayYear).format(civil(date))
/** "Oct 20, 2026" */
export const datePlain = (date: string) => plainDate.format(civil(date))
/** "Today 9:14 am", "Yesterday 7:21 pm" or "Tue, Oct 20 · 6:00 am". */
export function whenLabel(s: any, value: unknown, zone?: string) {
  if (value === null || value === undefined || value === '') return '—'
  const instant = at(value), date = dayOf(s, instant, zone), today = localDate(Date.now(), zone ?? zoneOf(s) ?? 'UTC')
  const yesterday = localDate(Date.parse(today + 'T12:00:00Z') - 86_400_000, 'UTC')
  const label = date === today ? 'Today' : date === yesterday ? 'Yesterday' : dayShort(s, date) + ' ·'
  return `${label} ${clock(s, instant, zone)}`
}
export function when(s: any, value: unknown, zone?: string) {
  if (value === null || value === undefined || value === '') return '—'
  return `<time datetime="${h(at(value).toISOString())}">${h(whenLabel(s,value,zone))}</time>`
}
/** Minutes between two instants: "50 min". */
export const length = (start: unknown, end: unknown) => `${Math.round((Date.parse(String(end)) - Date.parse(String(start))) / 60_000)} min`

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
/** Whole cents as US dollars: 18900 → "$189.00". */
export const money = (cents: unknown) => usd.format(Number(cents ?? 0) / 100)

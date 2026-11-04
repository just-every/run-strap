// Shared plain-text dates for notices and the screens that describe them.
import { localDate } from './zone'

export const quantity = (n: number, singular: string, plural = singular + 's') => `${n} ${n === 1 ? singular : plural}`
export const durationText = (minutes: number) => minutes % 1440 === 0 ? quantity(minutes / 1440, 'day') : minutes % 60 === 0 ? quantity(minutes / 60, 'hour') : quantity(minutes, 'minute')

export function dateText(value: string | number, timeZone: string, year = false) {
  return new Intl.DateTimeFormat('en-US', {timeZone,weekday:'short',month:'short',day:'numeric',...(year ? {year:'numeric'} : {})}).format(new Date(value))
}
export function clockText(value: string | number, timeZone: string, seconds = false) {
  return new Intl.DateTimeFormat('en-US', {timeZone,hour:'numeric',minute:'2-digit',...(seconds ? {second:'2-digit'} : {})}).format(new Date(value)).replace(/\s*([AP]M)$/, (_, p: string) => ' ' + p.toLowerCase())
}
export function momentText(value: string, timeZone: string) {
  const year = localDate(value,timeZone).slice(0,4) !== localDate(Date.now(),timeZone).slice(0,4)
  return `${dateText(value,timeZone,year)} · ${clockText(value,timeZone)}`
}
/** Overnight classes retain both calendar days; equal meridiems need saying once. */
export function rangeText(start: string, end: string, timeZone: string) {
  if (localDate(start,timeZone) !== localDate(end,timeZone)) return `${momentText(start,timeZone)}–${momentText(end,timeZone)}`
  const from = momentText(start,timeZone), until = clockText(end,timeZone)
  return `${from.endsWith(until.slice(-3)) ? from.slice(0,-3) : from}–${until}`
}
/** Expiration is exclusive. Midnight means the preceding day is the last usable day. */
export function goodThroughText(value: string, timeZone: string) {
  const at = Date.parse(value), last = at - 1, midnight = localDate(at,timeZone) !== localDate(last,timeZone)
  return `Good through ${dateText(last,timeZone,true)}${midnight ? '' : ` · until ${clockText(at,timeZone,new Date(at).getUTCSeconds() !== 0)}`}`
}

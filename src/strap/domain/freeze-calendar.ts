import { insist, instant, integer } from './types';

type Wall = {year:number;month:number;day:number;hour:number;minute:number;second:number;millisecond:number};
const formats = new Map<string,Intl.DateTimeFormat>();
function formatter(zone: string) {
  let format = formats.get(zone);
  if (!format) {
    try { format = new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
    catch { insist(false,'invalid_studio_zone'); }
    formats.set(zone,format);
  }
  return format;
}
function wall(at: number, zone: string): Wall {
  const p = Object.fromEntries(formatter(zone).formatToParts(new Date(at)).filter(p => p.type !== 'literal').map(p => [p.type,Number(p.value)]));
  return {year:p.year,month:p.month,day:p.day,hour:p.hour,minute:p.minute,second:p.second,millisecond:new Date(at).getUTCMilliseconds()};
}
const epoch = (p: Wall) => {
  const d = new Date(0);
  d.setUTCFullYear(p.year,p.month-1,p.day); d.setUTCHours(p.hour,p.minute,p.second,p.millisecond);
  return d.getTime();
};
const sameWall = (a: Wall, b: Wall) => Object.keys(a).every(k => a[k as keyof Wall] === b[k as keyof Wall]);
/** Resolve a wall clock exactly. A repeated time uses its earlier occurrence;
 * a skipped time is refused, never moved silently to another hour or day. */
function resolveWall(p: Wall, zone: string) {
  const nominal = epoch(p), offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 12) {
    const sample = nominal+hours*3_600_000;
    offsets.add(epoch(wall(sample,zone))-sample);
  }
  const matches = [...offsets].map(offset => nominal-offset).filter(at => sameWall(wall(at,zone),p));
  insist(matches.length > 0,'nonexistent_studio_time');
  return new Date(Math.min(...matches)).toISOString();
}
/** Date-only inputs mean midnight in the studio. Supplied instants must already
 * be that studio's midnight, including zero seconds and milliseconds. */
export function studioDayInstant(value: unknown, zone: string): string {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)) {
    const [year,month,day] = value.split('-').map(Number);
    const p = {year,month,day,hour:0,minute:0,second:0,millisecond:0};
    insist(year >= 1,'invalid_freeze_date');
    insist(new Date(epoch(p)).toISOString().slice(0,10) === value,'invalid_freeze_date');
    return resolveWall(p,zone);
  }
  const canonical = instant(value,'freeze_date'), p = wall(Date.parse(canonical),zone);
  insist(p.hour === 0 && p.minute === 0 && p.second === 0 && p.millisecond === 0,'freeze_date_requires_studio_midnight');
  return canonical;
}
/** Difference between civil dates, unaffected by 23-hour or 25-hour days. */
export function calendarDays(startAt: string, endAt: string, zone: string): number {
  const midnight = (value: string) => {
    const p = wall(Date.parse(studioDayInstant(value,zone)),zone);
    return epoch({...p,hour:0,minute:0,second:0,millisecond:0});
  };
  const days = (midnight(endAt)-midnight(startAt))/86_400_000;
  return integer(days,'freeze_calendar_days',1,3_660_000);
}
/** Move by calendar days and preserve the exact local hour, minute, second and
 * millisecond. Negative days support reversing a scheduled freeze's date move. */
export function shiftCalendarDays(at: string, days: number, zone: string): string {
  integer(days,'calendar_days',-3_660_000,3_660_000);
  const canonical = instant(at,'billing_date'), original = wall(Date.parse(canonical),zone);
  if (days === 0) return canonical;
  const date = new Date(epoch({...original,hour:0,minute:0,second:0,millisecond:0})+days*86_400_000);
  insist(date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999,'invalid_shifted_date');
  return resolveWall({...original,year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()},zone);
}

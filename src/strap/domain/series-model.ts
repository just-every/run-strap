import { addDays, localDate, localInstant, mondayOf } from '../zone';
import { insist, integer, list, now, record, text, type RecordData, type State } from './types';
import { studioSettings } from './studio';

export function civilDate(value: unknown) {
  const date = text(value,'date',10);
  insist(/^\d{4}-\d\d-\d\d$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date,'invalid_date');
  return date;
}
/** Reject nonexistent DST wall times instead of silently shifting a class. */
export function wallStart(date: string, value: unknown, zone: string) {
  const time = text(value,'time',5);
  insist(/^([01]\d|2[0-3]):[0-5]\d$/.test(time),'invalid_time');
  const at = localInstant(civilDate(date),time,zone), rendered = new Intl.DateTimeFormat('en-GB',{timeZone:zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(at));
  insist(localDate(at,zone) === date && rendered === time,'local_time_does_not_exist');
  return at;
}
export function studioZone(state: State) {
  const studio = studioSettings(state); insist(studio,'studio_settings_required'); return studio!;
}
export function recurrence(state: State, input: Record<string,unknown>) {
  const studio = studioZone(state), startDate = civilDate(input.startDate), endDate = civilDate(input.endDate);
  insist(endDate >= startDate,'series_end_must_follow_start');
  const intervalWeeks = integer(input.intervalWeeks ?? 1,'interval_weeks',1,52), dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date,intervalWeeks*7)) {
    insist(dates.length < 104,'series_maximum_104_occurrences'); dates.push(date);
  }
  const minutes = integer(input.minutes,'minutes',5,600), time = text(input.time,'time',5);
  for (const date of dates) wallStart(date,time,studio.timeZone);
  return {startDate,endDate,intervalWeeks,time,minutes,timeZone:studio.timeZone,location:studio.location,dates};
}
export function seriesSelection(state: State, input: Record<string,unknown>, cancelling = false) {
  const selected = record(state,input.classId,'class');
  insist(selected.seriesId,'series_class_required');
  const scope = text(input.scope,'scope',20);
  insist((cancelling ? ['this','future','series'] : ['this','future']).includes(scope),'invalid_series_scope');
  const series = record(state,selected.seriesId,'series');
  const classes = list(state,'class').filter(c => c.seriesId === series.id && c.status === 'published' && c.start > now()
    && (scope === 'series' || (scope === 'this' ? c.id === selected.id : c.seriesIndex >= selected.seriesIndex)))
    .sort((a,b) => a.seriesIndex-b.seriesIndex);
  insist(classes.length && (scope === 'series' || classes.some(c => c.id === selected.id)),'class_already_started',409);
  return {series,selected,scope,classes};
}
export const classWeek = (date: string) => mondayOf(date);
/** All facts that can affect the reviewed booking, spot, credit and notice effect.
 * Exception reasons never enter an agent's draft or error. */
export async function seriesBasis(state: State) {
  const kinds = ['messageTemplates','messagePreference','studio','series','class','booking','pack','spotLayout','bookingRule','waitlistPolicy','closure'];
  const facts = JSON.stringify({people:state.people,records:kinds.flatMap(kind => list(state,kind).filter(r => kind !== 'closure' || r.status === 'applied').sort((a,b) => a.id.localeCompare(b.id)).map(r => kind === 'closure' ? {id:r.id,status:r.status,scope:r.scope,room:r.room,start:r.start,end:r.end,classIds:r.classIds} : r)),
    unavailable:list(state,'unavailability').map(({reason,...r}) => r).sort((a,b) => a.id.localeCompare(b.id))});
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(facts))),byte => byte.toString(16).padStart(2,'0')).join('');
}
export const mailBasis = (context: {mailConfigured?: boolean; origin?: string}) => JSON.stringify([!!context.mailConfigured,context.origin ?? null]);

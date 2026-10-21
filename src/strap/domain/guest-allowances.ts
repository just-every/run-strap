import { integer, insist, list, now, record, text, type RecordData, type State } from './types';
import { nextPeriod, periodOf, periods, type Plan } from './entitlements';
import { studioZone, packServiceEligible } from './pack-credits';

export interface GuestTerms {
  passes: number; period: 'week' | 'month'; rollover: number; services: string[];
  perGuest: number; windowDays: number; excess: 'refuse' | 'charge'; priceCents: number;
}
export function parseGuestTerms(value: unknown): GuestTerms | null {
  if (value === undefined || value === null) return null;
  insist(typeof value === 'object' && !Array.isArray(value),'invalid_guest_terms');
  const g = value as Record<string,unknown>, passes = integer(g.passes,'guest_passes',1,100);
  insist(g.period === 'week' || g.period === 'month','invalid_guest_period');
  insist(g.excess === 'refuse' || g.excess === 'charge','invalid_guest_excess');
  insist(Array.isArray(g.services) && g.services.length <= 100,'invalid_guest_services');
  const services = [...new Set(g.services.map(v => text(v,'guest_service',160)))];
  return {passes,period:g.period,rollover:integer(g.rollover ?? 0,'guest_rollover',0,passes),services,
    perGuest:integer(g.perGuest ?? 1,'per_guest_limit',1,100),windowDays:integer(g.windowDays ?? 365,'guest_window_days',1,3660),
    excess:g.excess,priceCents:integer(g.priceCents ?? 0,'guest_price',g.excess === 'charge' ? 1 : 0,100_000_000)};
}
const plan = (terms: GuestTerms): Plan => ({kind:'visits',name:null,visits:terms.passes,period:terms.period,rollover:terms.rollover,days:null,from:null,to:null,maxUpcoming:null});
export const guestHolds = (b: RecordData) => b.guestPackId && b.status === 'booked' && b.attendance !== 'excused';
const passStarts = (state: State, pack: RecordData, except?: string) => list(state,'booking').filter(b => b.id !== except && b.guestPackId === pack.id && b.guestFunding === 'pass' && guestHolds(b)).map(b => record(state,b.classId,'class').start as string);
export function guestPeriods(state: State, pack: RecordData, through = now(), except?: string) {
  if (!pack.guestTerms) return [];
  const p = plan(pack.guestTerms), zone = studioZone(state);
  return periods(p,passStarts(state,pack,except),zone,pack.createdAt,through).map(row => ({...row,endsOn:nextPeriod(p,row.start)}));
}
export function guestPassRefusal(state: State, pack: RecordData, entry: RecordData, guestId: string, except?: string) {
  const terms: GuestTerms = pack.guestTerms;
  insist(terms,'guest_allowance_required',409);
  insist(pack.expiresAt > now() && pack.expiresAt > entry.start && pack.createdAt <= entry.start,'guest_allowance_expired',409);
  insist(packServiceEligible({id:pack.id,eligibleServices:terms.services},entry),'guest_service_ineligible',409);
  const p = plan(terms), zone = studioZone(state), starts = [...passStarts(state,pack,except),entry.start];
  if (periods(p,starts,zone,pack.createdAt).some(row => row.used > row.allowance)) return 'guest_allowance_used';
  const times = list(state,'booking').filter(b => b.id !== except && b.personId === guestId && b.guestFunding === 'pass' && guestHolds(b)).map(b => Date.parse(record(state,b.classId,'class').start));
  times.push(Date.parse(entry.start)); times.sort((a,b) => a-b);
  // Check every rolling window, including future bookings already held. Booking
  // an earlier class cannot invalidate a later complimentary reservation.
  const limits = [terms,...list(state,'booking').filter(b => b.id !== except && b.personId === guestId && b.guestFunding === 'pass' && guestHolds(b)).map(b => record(state,b.guestPackId,'pack').guestTerms as GuestTerms)];
  if (limits.some(limit => times.some((end,i) => times.slice(0,i+1).filter(start => end-start < limit.windowDays*86400_000).length > limit.perGuest))) return 'guest_complimentary_limit';
  return null;
}
export function guestAllowanceSummary(state: State, pack: RecordData) {
  if (!pack.guestTerms) return null;
  const period = periodOf(plan(pack.guestTerms),now(),studioZone(state));
  const rows = guestPeriods(state,pack), current = rows.find(row => row.start === period);
  return {terms:pack.guestTerms,periods:rows,expiresAt:pack.expiresAt,left:pack.expiresAt > now() ? Math.max(0,(current?.allowance ?? pack.guestTerms.passes)-(current?.used ?? 0)) : 0};
}

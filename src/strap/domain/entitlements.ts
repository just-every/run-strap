import { addDays, localDate, localInstant, mondayOf } from '../zone';
import { insist, integer, text, type RecordData } from './types';

// PLAN-002 plan terms. A pack without `entitlement` is a finite credit pack
// (PLAN-003). A visits plan grants `visits` per calendar week (Monday 00:00) or
// month (the 1st, 00:00) in the studio time zone; an unlimited plan has no
// visit count. Any plan may add weekdays and a local start-time window (from
// inclusive, to exclusive) and a cap on upcoming reservations held at once.
// A class counts in the period of its local start. Unused visits carry into the
// next period only, up to `rollover`; carried visits are used first and never
// carry again. Carry is projected from current reservations, so a reservation
// is refused when it would leave any period holding more visits than it grants.
// These are pure functions of records, shared by the domain and the screens.
export interface Plan {
  kind: 'credits' | 'visits' | 'unlimited'; name: string | null;
  visits: number | null; period: 'week' | 'month' | null; rollover: number;
  days: number[] | null; from: string | null; to: string | null; maxUpcoming: number | null;
}
export interface Held { id: string; start: string; booked: boolean }

const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/, dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const blank = (value: unknown) => value === undefined || value === null || value === '';

/** Plan terms from a pack.prepare input; null keeps a plain credit pack. */
export function parsePlan(input: Record<string,unknown>): Plan | null {
  const kind = (blank(input.kind) ? 'credits' : input.kind) as Plan['kind'];
  insist(['credits','visits','unlimited'].includes(kind),'invalid_plan_kind');
  const name = blank(input.planName) ? null : text(input.planName,'planName',80).replace(/\s+/g,' ');
  const visits = kind === 'visits' ? integer(input.visits,'visits',1,100) : null;
  insist(kind === 'visits' ? input.period === 'week' || input.period === 'month' : blank(input.period),'invalid_period');
  const rollover = kind === 'visits' ? integer(input.rollover ?? 0,'rollover',0,visits!) : 0;
  insist(kind === 'visits' || blank(input.rollover) || input.rollover === 0,'invalid_rollover');
  let days: number[] | null = null;
  if (!blank(input.days)) {
    insist(Array.isArray(input.days) && input.days.length >= 1 && input.days.length <= 7,'invalid_days');
    days = [...new Set((input.days as unknown[]).map(day => integer(day,'days',1,7)))].sort();
  }
  const from = blank(input.from) ? null : String(input.from), to = blank(input.to) ? null : String(input.to);
  insist((from === null) === (to === null),'plan_hours_need_from_and_to');
  if (from !== null) insist(time.test(from) && (time.test(to!) || to === '24:00') && from < to!,'invalid_plan_hours');
  const maxUpcoming = blank(input.maxUpcoming) ? null : integer(input.maxUpcoming,'maxUpcoming',1,100);
  if (kind === 'credits' && !name && !days && !from && maxUpcoming === null) return null;
  return {kind,name,visits,period:kind === 'visits' ? input.period as Plan['period'] : null,rollover,days,from,to,maxUpcoming};
}

export const planOf = (pack: RecordData): Plan | null => pack.entitlement ?? null;
/** Credit packs spend and return credits; visit and unlimited plans hold visits. */
export const countsCredits = (pack: RecordData) => (pack.entitlement?.kind ?? 'credits') === 'credits';
export const planStart = (pack: RecordData): string => pack.termStartAt ?? pack.createdAt;

/** A booking holds one of the pack's visits while booked (attended and no-show
 * included) and after a late cancel that kept it; release ends the hold. */
export const holds = (b: RecordData, packId: string) => b.packId === packId
  && (b.attendance === 'absence' || (b.status === 'booked' && b.attendance !== 'excused') || (b.status === 'cancelled' && b.cancellation === 'late' && b.refunded !== true));
export const heldVisits = (pack: RecordData, bookings: RecordData[], classStart: (id: string) => string | undefined): Held[] =>
  bookings.filter(b => holds(b,pack.id)).flatMap(b => { const start = classStart(b.classId); return start ? [{id:b.id,start,booked:b.status === 'booked'}] : [] });

const wall = (at: string, zone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',weekday:'short',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(at)).map(p => [p.type,p.value]));
  return {day:dayNames.indexOf(parts.weekday)+1,clock:`${parts.hour}:${parts.minute}`};
};
/** The class's local weekday and start time fall inside the plan's hours. */
export function inPlanHours(plan: Plan | null, start: string, zone: string) {
  if (!plan || (!plan.days && !plan.from)) return true;
  const at = wall(start,zone);
  return (!plan.days || plan.days.includes(at.day)) && (!plan.from || (at.clock >= plan.from && at.clock < plan.to!));
}

/** The civil date a class's period starts on, in the studio zone. */
export const periodOf = (plan: Plan, at: string, zone: string) => { const date = localDate(at,zone); return plan.period === 'week' ? mondayOf(date) : date.slice(0,8)+'01'; };
export const nextPeriod = (plan: Plan, start: string) => {
  if (plan.period === 'week') return addDays(start,7);
  const [year,month] = start.split('-').map(Number);
  return month === 12 ? `${year+1}-01-01` : `${year}-${String(month+1).padStart(2,'0')}-01`;
};
export const periodEndsAt = (plan: Plan, start: string, zone: string) => new Date(localInstant(nextPeriod(plan,start),'00:00',zone)).toISOString();

export interface Period { start: string; visits: number; carriedIn: number; allowance: number; used: number; carriedOut: number }
/** Visits by period from the plan's first period through the last one holding a visit. */
export function periods(plan: Plan, starts: string[], zone: string, firstAt: string, through?: string): Period[] {
  const counts = new Map<string,number>();
  for (const start of starts) { const key = periodOf(plan,start,zone); counts.set(key,(counts.get(key) ?? 0)+1); }
  const keys = [...counts.keys(),periodOf(plan,firstAt,zone),...(through ? [periodOf(plan,through,zone)] : [])].sort();
  const out: Period[] = [], last = keys.at(-1)!;
  let key = keys[0], carriedIn = 0;
  while (key <= last) {
    const used = counts.get(key) ?? 0, visits = plan.visits!;
    const carriedOut = Math.min(plan.rollover,Math.max(0,visits-Math.max(0,used-carriedIn)));
    out.push({start:key,visits,carriedIn,allowance:visits+carriedIn,used,carriedOut});
    carriedIn = carriedOut; key = nextPeriod(plan,key);
  }
  return out;
}
const overAllocated = (plan: Plan, starts: string[], zone: string, firstAt: string) => periods(plan,starts,zone,firstAt).some(p => p.used > p.allowance);

/** Why this pack's plan cannot hold one more visit in a class starting at
 * `start` now, or null. `except` is the booking being moved or restored. */
export function planRefusal(pack: RecordData, start: string, held: Held[], zone: string, at: string, except?: string): string | null {
  const plan = planOf(pack);
  if (!plan) return null;
  if (!inPlanHours(plan,start,zone)) return 'outside_plan_hours';
  const others = held.filter(item => item.id !== except);
  const upcoming = (value: string) => Date.parse(value) > Date.parse(at);
  if (plan.maxUpcoming !== null && upcoming(start) && others.filter(item => item.booked && upcoming(item.start)).length >= plan.maxUpcoming) return 'plan_upcoming_limit_reached';
  if (plan.kind === 'visits' && overAllocated(plan,[...others.map(item => item.start),start],zone,planStart(pack))) return 'plan_visits_used';
  return null;
}

/** How many more visits the period of `at` can take without leaving any period over. */
export function visitsLeft(pack: RecordData, held: Held[], zone: string, at: string) {
  const plan = planOf(pack);
  if (!plan || plan.kind !== 'visits') return null;
  const starts = held.map(item => item.start);
  let left = 0;
  while (left < plan.visits!+plan.rollover && !overAllocated(plan,[...starts,...Array(left+1).fill(at)],zone,planStart(pack))) left++;
  return left;
}

const clock12 = (value: string) => { const [hour,minute] = value.split(':').map(Number); return value === '24:00' ? 'midnight' : `${hour % 12 || 12}:${String(minute).padStart(2,'0')} ${hour < 12 ? 'am' : 'pm'}`; };
/** "Mon–Fri" or "Mon, Wed, Sat". */
const dayText = (days: number[]) => days.length === 7 ? 'every day' : days.every((day,i) => i === 0 || day === days[i-1]+1) && days.length > 2 ? `${dayNames[days[0]-1]}–${dayNames[days.at(-1)!-1]}` : days.map(day => dayNames[day-1]).join(', ');
/** The plan's terms in one line, as members and staff read them. */
export function planTerms(plan: Plan) {
  const count = plan.kind === 'unlimited' ? 'Unlimited visits' : plan.kind === 'visits' ? `${plan.visits} visit${plan.visits === 1 ? '' : 's'} a ${plan.period}${plan.rollover ? `, up to ${plan.rollover} unused roll${plan.rollover === 1 ? 's' : ''} over` : ''}` : 'Class credits';
  const hours = plan.days || plan.from ? ` · ${plan.days ? dayText(plan.days) : 'every day'}${plan.from ? ` ${clock12(plan.from)}–${clock12(plan.to!)} starts` : ''}` : '';
  return `${count}${hours}${plan.maxUpcoming ? ` · up to ${plan.maxUpcoming} upcoming booking${plan.maxUpcoming === 1 ? '' : 's'} at once` : ''}`;
}

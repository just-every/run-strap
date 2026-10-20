import { id, insist, list, now, record, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { countsCredits, heldVisits, periodEndsAt, periodOf, periods, planOf, planRefusal, planStart, visitsLeft } from './entitlements';
import { studioSettings } from './studio';

/** Service labels are identities within a studio, independent of rooms. */
export const serviceKey = (value: string) => value.trim().replace(/\s+/g,' ').toLowerCase();
export function packServiceEligible(pack: RecordData, entry: RecordData) {
  const services: string[] = pack.eligibleServices ?? [];
  const service = entry.service ?? String(entry.title).split(' · ')[0];
  return !services.length || services.some(value => serviceKey(value) === serviceKey(service));
}
export const studioZone = (state: State): string => studioSettings(state)?.timeZone ?? 'UTC';
const startOf = (state: State) => (classId: string) => state.records.get(classId)?.data.start as string | undefined;
export const packHeld = (state: State, pack: RecordData) => heldVisits(pack,list(state,'booking'),startOf(state));
/** PLAN-002: why the pack's plan cannot hold one more visit in this class now. */
export const planBlock = (state: State, pack: RecordData, entry: RecordData, except?: string) =>
  pack.entitlement ? planRefusal(pack,entry.start,packHeld(state,pack),studioZone(state),now(),except) : null;
/** A pack can take one more booking in this class: a credit or a plan visit. */
export const packCanSeat = (state: State, pack: RecordData, entry: RecordData, except?: string) =>
  (!countsCredits(pack) || pack.remaining > 0) && !planBlock(state,pack,entry,except);
export const packEvents = (state: State, pack: RecordData) => list(state,'packCreditEvent')
  .filter(event => event.packId === pack.id).sort((a,b) => a.revision-b.revision);

function legacyReservations(state: State, pack: RecordData) {
  return list(state,'booking').filter(b => b.packId === pack.id && b.status === 'booked')
    .map(b => ({bookingId:b.id,status:b.checkedInAt ? 'consumed' : 'reserved'}));
}

/** An opening balance is observed now, never presented as a historical grant. */
function openLegacyLedger(tx: Transaction, pack: RecordData) {
  if (pack.creditLedgerVersion === 1) return;
  const opening = {id:id(),packId:pack.id,personId:pack.personId,type:'opening',credits:pack.remaining,
    originalCredits:pack.credits,remainingAfter:pack.remaining,expiresAtAfter:pack.expiresAt,
    reservations:legacyReservations(tx.state,pack),revision:1,createdAt:now(),actorId:tx.who.id,actorRole:tx.who.role};
  tx.put('packCreditEvent',opening);
  tx.put('pack',{...pack,creditLedgerVersion:1,creditRevision:1});
}

type CreditEvent = {
  type: 'grant' | 'reserve' | 'restore' | 'consume' | 'adjust' | 'transfer' | 'change'; credits: number;
  bookingId?: string; classId?: string; reason?: string; expiresAt?: string;
  requestId?: string; requestBasis?: string;
};
/** A booking's credit event on its own pack; an unsettled unpaid visit (SCHED-010) has none. */
export function bookingCredit(tx: Transaction, booking: RecordData, input: CreditEvent) {
  return booking.packId ? appendPackEvent(tx,record(tx.state,booking.packId,'pack'),input) : null;
}
/** Each call inserts a fresh event; balance and ledger share the command fence. */
export function appendPackEvent(tx: Transaction, pack: RecordData, input: CreditEvent) {
  openLegacyLedger(tx,pack);
  const current = record(tx.state,pack.id,'pack');
  // A visit or unlimited plan records each hold and release with no credit change.
  if (!countsCredits(current)) { insist(input.credits === 0 || !['adjust','change'].includes(input.type),'plan_has_no_credit_balance',409); input = {...input,credits:0}; }
  const remaining = current.remaining + input.credits;
  insist(Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= 1_000_000,'invalid_credit_balance',409);
  const revision = (current.creditRevision ?? 0)+1;
  const event = {id:id(),packId:pack.id,personId:pack.personId,...input,revision,remainingAfter:remaining,
    expiresAtBefore:current.expiresAt,expiresAtAfter:input.expiresAt ?? current.expiresAt,
    createdAt:now(),actorId:tx.who.id,actorRole:tx.who.role};
  insist(!tx.state.records.has(event.id),'credit_event_exists',409);
  tx.put('packCreditEvent',event);
  tx.put('pack',{...current,remaining,expiresAt:event.expiresAtAfter,creditRevision:revision});
  return event;
}

/** Reserved and consumed are current allocations; restored is cumulative usage.
 * Pre-ledger usage without surviving bookings stays explicitly unknown. */
export function packSummary(state: State, pack: RecordData) {
  const events = packEvents(state,pack), opening = events.find(e => e.type === 'opening');
  const legacyOpening = !!opening || pack.creditLedgerVersion !== 1;
  const reservations = new Map<string,string>();
  if (legacyOpening) for (const item of opening?.reservations ?? legacyReservations(state,pack)) reservations.set(item.bookingId,item.status);
  for (const event of events) {
    if (!event.bookingId) continue;
    if (event.type === 'reserve') reservations.set(event.bookingId,'reserved');
    if (event.type === 'consume') reservations.set(event.bookingId,'consumed');
    if (event.type === 'restore') reservations.delete(event.bookingId);
  }
  const reserved = [...reservations.values()].filter(value => value === 'reserved').length;
  const consumed = [...reservations.values()].filter(value => value === 'consumed').length;
  const expiredNow = Date.parse(pack.expiresAt) <= Date.now();
  const expired = expiredNow ? pack.remaining : 0;
  const knownOpeningUse = (opening?.reservations ?? legacyReservations(state,pack)).length;
  const unaccountedLegacy = legacyOpening ? Math.max(0,(opening?.originalCredits ?? pack.credits)-(opening?.credits ?? pack.remaining)-knownOpeningUse) : 0;
  return {remaining:pack.remaining-expired,balance:pack.remaining,reserved,consumed,plan:planSummary(state,pack,reservations),
    restored:events.filter(e => e.type === 'restore').reduce((sum,e) => sum+e.credits,0),expired,
    expiredAt:expiredNow ? pack.expiresAt : null,
    legacyOpening,unaccountedLegacy,revision:pack.creditRevision ?? 0};
}

/** PLAN-002 visits by period: reservations, attendance, late cancels that kept
 * the visit, returns, carried and expired visits, for one plan. */
function planSummary(state: State, pack: RecordData, reservations: Map<string,string>) {
  const plan = planOf(pack);
  if (!plan || plan.kind === 'credits') return null;
  const zone = studioZone(state), at = Date.parse(now()), expiresAt = Date.parse(pack.expiresAt), held = packHeld(state,pack);
  const lost = new Set(list(state,'booking').filter(b => b.packId === pack.id && b.status === 'cancelled' && b.cancellation === 'late' && b.refunded !== true).map(b => b.id));
  const returns = packEvents(state,pack).filter(e => e.type === 'restore' && e.bookingId);
  const counts = (ids: string[]) => ({reserved:ids.filter(id => reservations.get(id) === 'reserved').length,
    attended:ids.filter(id => reservations.get(id) === 'consumed' && !lost.has(id)).length,lateCancelled:ids.filter(id => lost.has(id)).length});
  const totals = {...counts([...reservations.keys()]),returned:returns.length};
  if (plan.kind === 'unlimited') return {kind:plan.kind,...totals,periods:[],left:null};
  const startOfClass = (classId: string) => state.records.get(classId)?.data.start as string | undefined;
  const periodOfBooking = (bookingId: string) => { const start = startOfClass(state.records.get(bookingId)?.data.classId); return start ? periodOf(plan,start,zone) : null; };
  // Periods run from the plan's start through now (or its earlier expiry), never before the start.
  const through = new Date(Math.max(Date.parse(planStart(pack)),Math.min(at,expiresAt))).toISOString();
  const rows = periods(plan,held.map(item => item.start),zone,planStart(pack),through).map(p => {
    const endsAt = periodEndsAt(plan,p.start,zone), last = expiresAt <= Date.parse(endsAt), ended = Date.parse(endsAt) <= at || (last && expiresAt <= at);
    return {...p,endsAt,ended,...counts(held.filter(item => periodOf(plan,item.start,zone) === p.start).map(item => item.id)),
      returned:returns.filter(e => periodOfBooking(e.bookingId) === p.start).length,
      expired:ended ? Math.max(0,p.allowance-p.used-(last ? 0 : p.carriedOut)) : 0};
  });
  return {kind:plan.kind,...totals,periods:rows,left:expiresAt > at ? visitsLeft(pack,held,zone,now()) : 0};
}

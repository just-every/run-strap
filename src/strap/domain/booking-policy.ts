import { humanOwner, insist, integer, list, now, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { serviceKey } from './pack-credits';

// SCHED-006 booking windows and cancellation rules. A plan's own rule (PLAN-002,
// by the plan name on the member's pack) wins for bookings that plan seats; a
// service's rule wins over the studio-wide rule; with none, booking is open
// until the class starts and every pre-start cancellation is early.
// Hours and minutes are elapsed time before the class's UTC start instant, so a
// daylight-saving change between the two moves the wall-clock boundary.
export interface Rule {
  id: string | null; service: string | null; plan?: string | null; revision: number;
  opensHoursBefore: number | null; priorityOpensHoursBefore: number | null;
  closesMinutesBefore: number; cancelCutoffHours: number;
  lateCancelReturnsCredit: boolean; lateCancelFeeCents: number; noShowFeeCents: number; noShowGraceMinutes: number;
}
const builtIn: Rule = {id:null,service:null,revision:0,opensHoursBefore:null,priorityOpensHoursBefore:null,closesMinutesBefore:0,cancelCutoffHours:0,lateCancelReturnsCredit:true,lateCancelFeeCents:0,noShowFeeCents:0,noShowGraceMinutes:0};
const ruleId = (service: string | null) => service === null ? 'booking-rule:studio' : `booking-rule:${serviceKey(service)}`;
const planRuleId = (plan: string) => `booking-rule-plan:${serviceKey(plan)}`;
export const classService = (entry: RecordData) => entry.service ?? String(entry.title).split(' · ')[0];

export const bookingRules = (state: State) => list(state,'bookingRule').filter(r => r.status === 'active');
/** `pack` is the pack that seats (or would seat) the booking. */
export function ruleFor(state: State, entry: RecordData, pack?: RecordData | null): Rule {
  const rules = bookingRules(state), key = ruleId(classService(entry)), plan = pack?.entitlement?.name;
  return ((plan ? rules.find(r => r.id === planRuleId(plan)) : undefined) ?? rules.find(r => r.id === key) ?? rules.find(r => r.id === ruleId(null)) ?? builtIn) as Rule;
}
const before = (start: string, minutes: number) => new Date(Date.parse(start)-minutes*60_000).toISOString();

/** Booking opens at opensAt (inclusive) and closes at closesAt (exclusive). */
export function bookingWindow(state: State, entry: RecordData, pack?: RecordData | null) {
  const rule = ruleFor(state,entry,pack);
  return {ruleId:rule.id,service:rule.service,...(rule.plan ? {plan:rule.plan} : {}),
    opensAt:rule.opensHoursBefore === null ? null : before(entry.start,rule.opensHoursBefore*60),
    priorityOpensAt:rule.priorityOpensHoursBefore === null ? null : before(entry.start,rule.priorityOpensHoursBefore*60),
    closesAt:before(entry.start,rule.closesMinutesBefore),
    cancelCutoffHours:rule.cancelCutoffHours,cutoffAt:before(entry.start,rule.cancelCutoffHours*60),
    lateCancelReturnsCredit:rule.lateCancelReturnsCredit,lateCancelFeeCents:rule.lateCancelFeeCents,noShowFeeCents:rule.noShowFeeCents ?? 0,noShowGraceMinutes:rule.noShowGraceMinutes ?? 0};
}

/** Fences the window at commit: the committing Worker's clock decides. */
export function insistBookingOpen(tx: Transaction, entry: RecordData, priority: boolean, pack?: RecordData | null) {
  const window = bookingWindow(tx.state,entry,pack), at = now();
  const opensAt = priority && window.priorityOpensAt ? window.priorityOpensAt : window.opensAt;
  insist(at < window.closesAt,'booking_window_closed',409);
  tx.future(window.closesAt);
  if (opensAt) { insist(at >= opensAt,'booking_window_not_open',409); tx.reached(opensAt); }
  return window;
}
/** True when only the priority window (not the regular one) is open now. */
export function priorityOnly(state: State, entry: RecordData, pack?: RecordData | null) {
  const window = bookingWindow(state,entry,pack), at = now();
  return !!window.opensAt && at < window.opensAt && !!window.priorityOpensAt && at >= window.priorityOpensAt;
}
/** The pack's own booking window is open to it now (priority packs from the priority opening). */
export function windowOpen(state: State, entry: RecordData, pack: RecordData) {
  const window = bookingWindow(state,entry,pack), at = now(), opensAt = pack.priorityBooking === true && window.priorityOpensAt ? window.priorityOpensAt : window.opensAt;
  return at < window.closesAt && (!opensAt || at >= opensAt);
}

/** The cancellation terms a booking keeps from the moment it was made. */
export function cancelTerms(state: State, entry: RecordData, pack?: RecordData | null) {
  const rule = ruleFor(state,entry,pack);
  return {ruleId:rule.id,ruleRevision:rule.revision,cutoffHours:rule.cancelCutoffHours,lateReturnsCredit:rule.lateCancelReturnsCredit,lateFeeCents:rule.lateCancelFeeCents,noShowFeeCents:rule.noShowFeeCents ?? 0,noShowGraceMinutes:rule.noShowGraceMinutes ?? 0};
}

/** What cancelling this booking now does. Bookings made before SCHED-006 carry no
 * terms and keep the original rule: every pre-start cancellation is early. */
export function cancellationEffect(booking: RecordData, entry: RecordData, at = now()) {
  const terms = booking.cancelTerms ?? {cutoffHours:0,lateReturnsCredit:true,lateFeeCents:0};
  const cutoffAt = before(entry.start,terms.cutoffHours*60);
  const seated = booking.status === 'booked';
  const timing: 'early' | 'late' = seated && at >= cutoffAt ? 'late' : 'early';
  const effect = {timing,cutoffAt,unpaid:seated && !booking.packId && !booking.guestPackId,creditReturned:seated && (!!booking.guestPackId || (!!booking.packId && (timing === 'early' || terms.lateReturnsCredit))),feeCents:timing === 'late' ? terms.lateFeeCents : 0};
  return {...effect,key:`${effect.timing}|${effect.creditReturned ? 1 : 0}|${effect.feeCents}`,
    waivable:timing === 'late' && (!terms.lateReturnsCredit || terms.lateFeeCents > 0)};
}

function hours(value: unknown, field: string, min: number) {
  return value === null || value === undefined || value === '' ? null : integer(value,field,min,8760);
}
export function saveBookingRule(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const service = input.service === undefined || input.service === null || input.service === '' ? null : text(input.service,'service',160).replace(/\s+/g,' ');
  const plan = input.plan === undefined || input.plan === null || input.plan === '' ? null : text(input.plan,'plan',80).replace(/\s+/g,' ');
  insist(!service || !plan,'rule_targets_service_or_plan');
  const opensHoursBefore = hours(input.opensHoursBefore,'opens_hours_before',1);
  const priorityOpensHoursBefore = hours(input.priorityOpensHoursBefore,'priority_opens_hours_before',1);
  const closesMinutesBefore = integer(input.closesMinutesBefore ?? 0,'closes_minutes_before',0,10_080);
  const cancelCutoffHours = integer(input.cancelCutoffHours ?? 0,'cancel_cutoff_hours',0,720);
  const lateCancelFeeCents = integer(input.lateCancelFeeCents ?? 0,'late_cancel_fee_cents',0,100_000);
  const noShowGraceMinutes = integer(input.noShowGraceMinutes ?? 0,'no_show_grace_minutes',0,600);
  const noShowFeeCents = integer(input.noShowFeeCents ?? 0,'no_show_fee_cents',0,100_000);
  const lateCancelReturnsCredit = input.lateCancelReturnsCredit ?? true;
  insist(typeof lateCancelReturnsCredit === 'boolean','invalid_late_cancel_returns_credit');
  insist(priorityOpensHoursBefore === null || (opensHoursBefore !== null && priorityOpensHoursBefore > opensHoursBefore),'priority_window_must_open_before_regular_window');
  insist(opensHoursBefore === null || closesMinutesBefore < opensHoursBefore*60,'booking_window_must_close_after_it_opens');
  const key = plan ? planRuleId(plan) : ruleId(service), previous = tx.state.records.get(key)?.data;
  const rule = {id:key,service,...(plan ? {plan} : {}),status:'active',revision:(previous?.revision ?? 0)+1,opensHoursBefore,priorityOpensHoursBefore,closesMinutesBefore,cancelCutoffHours,lateCancelReturnsCredit,lateCancelFeeCents,noShowFeeCents,noShowGraceMinutes,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('bookingRule',rule); return rule;
}
/** A service rule can be removed; the studio rule then applies to that service. */
export function removeBookingRule(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const rule = tx.state.records.get(text(input.id,'id',200));
  insist(rule?.kind === 'bookingRule' && rule.data.status === 'active','booking_rule_not_found',404);
  const removed = {...rule.data,status:'removed',revision:rule.data.revision+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('bookingRule',removed); return removed;
}

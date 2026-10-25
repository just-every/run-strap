import { humanOwner, id, instant, insist, list, now, person, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { calculatePay, cancellationPay, cents, payRate, sumCents } from './teaching-pay-model';

export { calculatePay, payModes } from './teaching-pay-model';
export type { PayMode, PayRate, PayTier, CancellationPay } from './teaching-pay-model';

/** New immutable versions share a scope; there is no mutable current-rule row.
 * Precedence: instructor+service, instructor, service, studio. Within a scope,
 * latest effective instant wins. Equal instants retain the first saved version.
 * Service names match exactly after trimming, just as the class source records. */
export function selectPayRule(state: State, entry: RecordData) {
  const start = instant(entry.start,'start');
  const cancellationAt = entry.status === 'cancelled' && entry.cancelledAt ? instant(entry.cancelledAt,'cancelled_at') : null;
  const rank = (r: RecordData) => (r.instructorId ? 2 : 0)+(r.service ? 1 : 0);
  return list(state,'payRule').filter(r => r.effectiveAt <= start
    && (!r.instructorId || r.instructorId === entry.instructorId) && (!r.service || r.service === entry.service)
    && (!cancellationAt || r.createdAt <= cancellationAt))
    .sort((a,b) => rank(b)-rank(a) || b.effectiveAt.localeCompare(a.effectiveAt) || a.createdAt.localeCompare(b.createdAt) || a.version-b.version || a.id.localeCompare(b.id))[0] ?? null;
}

export function savePayRule(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(input.id === undefined && input.version === undefined,'pay_rules_are_immutable',409);
  const instructorId = input.instructorId == null || input.instructorId === '' ? null : text(input.instructorId,'instructor_id',100);
  if (instructorId) insist(person(tx.state,instructorId).role === 'instructor','instructor_required');
  const service = input.service == null || input.service === '' ? null : text(input.service,'service',160);
  const effectiveAt = instant(input.effectiveAt,'effective_at'), rate = payRate(input), cancellation = cancellationPay(input.cancellation);
  const substitute = input.substitute === undefined ? null : payRate(input.substitute);
  insist(!substitute || substitute.mode !== 'per-appointment' || rate.mode === 'per-appointment','substitute_pay_mode_mismatch');
  const createdAt = now();
  insist(effectiveAt > createdAt,'pay_rule_must_be_future',409);
  const previous = list(tx.state,'payRule').filter(r => r.instructorId === instructorId && r.service === service);
  insist(!previous.some(r => r.effectiveAt === effectiveAt),'pay_rule_effective_at_exists',409);
  const saved = {id:id(),version:previous.reduce((max,r) => Math.max(max,r.version),0)+1,instructorId,service,effectiveAt,...rate,cancellation,substitute,createdAt,createdBy:tx.who.id};
  tx.future(effectiveAt);
  tx.put('payRule',saved); return saved;
}

/** Substitute rates require explicit approved class provenance. This module
 * never infers substitution from a changed name, instructor version or roster.
 * A future substitution producer must retain this object on its real class. */
function substituteTeaching(entry: RecordData) {
  const substitution = entry.substitution;
  return !!(substitution && typeof substitution.id === 'string' && substitution.id.trim()
    && typeof substitution.originalInstructorId === 'string' && substitution.originalInstructorId.trim()
    && substitution.originalInstructorId !== entry.instructorId && substitution.instructorId === entry.instructorId
    && typeof substitution.approvedAt === 'string' && Number.isFinite(Date.parse(substitution.approvedAt)));
}

function classPay(state: State, entry: RecordData) {
  const bookings = list(state,'booking').filter(b => b.classId === entry.id);
  const attended = bookings.filter(b => b.attendance === 'attended');
  const rule = selectPayRule(state,entry), substitute = substituteTeaching(entry);
  const rate = rule && (substitute ? rule.substitute : rule);
  const adjustments = list(state,'payAdjustment').filter(a => a.classId === entry.id && a.instructorId === entry.instructorId);
  const adjustmentCents = sumCents(adjustments.map(a => a.amountCents));
  const source = {id:entry.id,classId:entry.id,title:entry.title,service:entry.service,instructorId:entry.instructorId,instructorName:entry.instructorName,
    start:entry.start,end:entry.end,classStatus:entry.status,cancelledAt:entry.cancelledAt ?? null,
    bookingIds:bookings.map(b => b.id),attendedBookingIds:attended.map(b => b.id),attendees:attended.length,
    ruleId:rule?.id ?? null,ruleVersion:rule?.version ?? null,rule,substitute,substitution:entry.substitution ?? null,adjustments,adjustmentCents};
  if (!rate) return {...source,status:'unconfigured' as const,unconfiguredReason:substitute && rule ? 'substitute_rate_missing' : 'pay_rule_missing',calculation:null,baseCents:null,totalCents:null};
  if (!entry.appointmentReservationId && (rule!.mode === 'per-appointment' || rate.mode === 'per-appointment')) return {...source,status:'unsupported' as const,unconfiguredReason:'appointment_pay_requires_appointment',calculation:null,baseCents:null,totalCents:null};
  const calculation = calculatePay(entry.appointmentReservationId && rate.mode === 'per-appointment' ? {...rate,mode:'flat-class'} : rate,entry.start,entry.end,attended.length,entry.status === 'cancelled' ? rule!.cancellation : undefined);
  return {...source,status:'calculated' as const,unconfiguredReason:null,calculation,baseCents:calculation.baseCents,totalCents:sumCents([calculation.baseCents,adjustmentCents])};
}

/** Earned rows only: completed classes and explicitly cancelled classes.
 * Inclusive exact-instant start filters, UTC comparison; no local-date guessing.
 * Incomplete rows keep null amounts; a partial sum never masquerades as total.
 * Private sessions earn pay only with retained attended booking provenance. */
export function teachingPay(state: State, instructorId?: string, from?: string, to?: string) {
  const lower = from === undefined ? null : instant(from,'from'), upper = to === undefined ? null : instant(to,'to');
  insist(!lower || !upper || lower <= upper,'invalid_pay_date_range');
  const at = now();
  const rows = list(state,'class').filter(c => (!instructorId || c.instructorId === instructorId)
    && (c.appointmentReservationId ? c.status !== 'cancelled' && instant(c.end,'end') <= at && list(state,'booking').some(b=>b.classId === c.id && b.attendance === 'attended') : c.status === 'cancelled' || instant(c.end,'end') <= at)
    && (!lower || instant(c.start,'start') >= lower) && (!upper || instant(c.start,'start') <= upper))
    .sort((a,b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)).map(entry => classPay(state,entry));
  const incomplete = rows.filter(row => row.totalCents === null);
  const configuredTotalCents = sumCents(rows.flatMap(row => row.totalCents === null ? [] : [row.totalCents]));
  return {asOf:at,instructorId:instructorId ?? null,from:lower,to:upper,currency:'USD',rows,complete:incomplete.length === 0,
    unconfiguredClassIds:incomplete.map(row => row.classId),configuredTotalCents,totalCents:incomplete.length ? null : configuredTotalCents,
    adjustmentTotalCents:sumCents(rows.map(row => row.adjustmentCents)),appointmentSupport:'taught_sessions_only',substitutionSupport:'explicit_class_provenance_required'};
}

/** Exact additive correction; neither a rule nor attendance is rewritten. The
 * original calculated basis remains attached even after attendance correction.
 * Replay is scoped to the owner and rejects any change to the accepted request. */
export function adjustTeachingPay(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const requestId = text(input.requestId,'request_id',100), classId = text(input.classId,'class_id',100);
  const amountCents = cents(input.amountCents,'amount_cents',true), reason = text(input.reason,'adjustment_reason',500);
  insist(amountCents !== 0,'adjustment_must_be_nonzero');
  const requestBasis = JSON.stringify({classId,amountCents,reason});
  const prior = list(tx.state,'payAdjustment').find(a => a.createdBy === tx.who.id && a.requestId === requestId);
  if (prior) { insist(prior.requestBasis === requestBasis,'pay_request_changed',409); return prior; }
  const entry = record(tx.state,classId,'class'), createdAt = now();
  insist(entry.appointmentReservationId ? entry.status !== 'cancelled' && instant(entry.end,'end') <= createdAt && list(tx.state,'booking').some(b=>b.classId === entry.id && b.attendance === 'attended') : entry.status === 'cancelled' || instant(entry.end,'end') <= createdAt,'teaching_pay_not_earned',409);
  if (entry.status !== 'cancelled') tx.reached(entry.end);
  const before = classPay(tx.state,entry);
  sumCents([before.adjustmentCents,amountCents]);
  if (before.totalCents !== null) sumCents([before.totalCents,amountCents]);
  const saved = {id:id(),classId,instructorId:entry.instructorId,amountCents,reason,requestId,requestBasis,
    ruleId:before.ruleId,ruleVersion:before.ruleVersion,bookingIds:before.bookingIds,attendedBookingIds:before.attendedBookingIds,
    before:{status:before.status,calculation:before.calculation,baseCents:before.baseCents,adjustmentCents:before.adjustmentCents,totalCents:before.totalCents},createdAt,createdBy:tx.who.id};
  tx.put('payAdjustment',saved); return saved;
}

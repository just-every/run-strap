import { humanOwner, id, insist, list, now, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { putNotice, reserveMail, titleOf, whenText } from './notices';

export const cancellationReasons = (state: State): string[] => state.records.get('cancellation-reasons')?.data.reasons ?? ['Sick','Schedule conflict','Other'];
export function saveCancellationReasons(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(Array.isArray(input.reasons) && input.reasons.length > 0 && input.reasons.length <= 50,'invalid_cancellation_reasons');
  const reasons = input.reasons.map(v => text(v,'cancellation_reason',100));
  insist(new Set(reasons.map(v => v.toLowerCase())).size === reasons.length,'duplicate_cancellation_reason');
  const saved = {id:'cancellation-reasons',reasons,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('cancellationReasons',saved); return saved;
}
export function staffReason(tx: Transaction, input: Record<string,unknown>) {
  const reason = text(input.cancelReason,'cancellation_reason',100);
  insist(cancellationReasons(tx.state).includes(reason),'unknown_cancellation_reason');
  return reason;
}
export function actionChannel(input: Record<string,unknown>) {
  const channel = text(input.channel ?? 'desk','channel',20);
  insist(['desk','phone','inbox'].includes(channel),'invalid_channel'); return channel;
}
/** Retained action identity doubles as the once-only notice identity. */
export function bookingHistory(tx: Transaction, action: string, before: RecordData, after: RecordData, input: Record<string,unknown>, details: Record<string,unknown> = {}) {
  const staff = tx.who.role === 'owner', entry = tx.state.records.get(after.classId)!.data;
  const suppressed = input.suppressNotice === true;
  insist(!suppressed || (staff && action === 'cancel' && after.cancellation !== 'late'),'suppression_requires_courtesy_cancel',403);
  const suppressionReason = suppressed ? text(input.suppressionReason,'suppression_reason',500) : null;
  const event = {id:id(),...(input.requestId ? {requestId:text(input.requestId,'requestId',100),requestBasis:JSON.stringify(Object.keys(input).sort().map(key => [key,input[key]]))} : {}),bookingId:after.id,personId:after.personId,classId:before.classId,targetClassId:after.classId,action,
    actorId:tx.who.id,actorRole:tx.who.role,staffMade:staff,right:staff ? 'booking' : null,channel:staff ? actionChannel(input) : 'online',
    reason:staff ? String(input.cancelReason ?? input.reason ?? '') : `Member ${action}`,at:now(),type:after.cancellation ?? null,
    feeCents:after.feeCents ?? 0,creditReturned:after.refunded ?? false,waiver:after.waiver ?? null,before,after,...details,
    notice:{status:suppressed ? 'suppressed' : 'in_app',suppressionReason,mailStatus:null as string | null}};
  if (!suppressed) {
    const subject = `${action === 'accept' ? 'Booking confirmed' : action === 'cancel' ? 'Booking cancelled' : action === 'move' ? 'Booking moved' : action === 'restore' ? 'Booking restored' : 'Waitlist updated'}: ${titleOf(entry)}`;
    const body = `${subject}, ${whenText(tx.state,entry.start)}. ${event.feeCents ? `A $${(Number(event.feeCents)/100).toFixed(2)} fee was added to your balance; no payment was collected. ` : ''}${action === 'cancel' ? after.refunded ? after.guestPackId ? 'Your guest pass was returned or the guest charge reversed once.' : 'Your credit was returned.' : after.cancellation === 'late' ? 'The visit stays used under your cancellation policy.' : 'No credit was used.' : action === 'move' ? after.guestPackId ? 'Your guest allocation and confirmed price moved to the new session.' : after.packId ? 'Your original credit was carried to the new session.' : 'Your unpaid visit moved; no credit was used.' : action === 'restore' ? after.guestPackId ? 'Your guest allocation was reserved again at its confirmed price.' : after.packId ? 'Your original booking credit was reused.' : 'Your unpaid visit was restored; no credit was used.' : action === 'accept' ? 'Your class is booked; one credit is reserved.' : 'See your booking in Strap.'}`;
    putNotice(tx,{id:`notice:action:${event.id}`,personId:after.personId,bookingId:after.id,classId:after.classId,subject,body});
    const delivery = reserveMail(tx,tx.notices,{id:`mail:action:${event.id}`,sourceKind:'booking_action',sourceId:event.id,personId:after.personId,bookingIds:[after.id],subject,body});
    event.notice.mailStatus = delivery.status;
  }
  tx.put('bookingAction',event); return event;
}

/** Older cancellations, class closures and system offer expiry already retain
 * their own facts. Project those records too, explicitly marking any fields
 * their producer did not record; never invent past actions or notices. */
export function bookingActions(state: State) {
  const actions = list(state,'bookingAction');
  const candidates = [...list(state,'booking').filter(b => b.status === 'cancelled'),...actions.filter(a => a.action === 'restore').map(a => a.before)];
  for (const b of candidates) {
    if (!b.cancelledAt || ['move_replaced','move_completed'].includes(b.cancellation) || actions.some(a => a.action === 'cancel' && a.bookingId === b.id && (a.id === b.cancellationId || a.after?.cancelledAt === b.cancelledAt || a.at === b.cancelledAt))) continue;
    const closure = b.closureId ? state.records.get(b.closureId)?.data : null;
    const notice = list(state,'notice').find(n => n.bookingId === b.id);
    actions.push({id:`recorded-cancellation:${b.id}:${b.cancelledAt}`,bookingId:b.id,personId:b.personId,classId:b.classId,action:'cancel',
      actorId:b.cancelledBy ?? 'Not recorded',actorRole:b.cancelledByRole ?? 'Not recorded',channel:'Not recorded',right:null,staffMade:b.cancelledByRole === 'owner',
      reason:closure?.reason ?? (b.cancellation === 'offer_expired' ? 'Offer expired unclaimed' : 'Not recorded'),at:b.cancelledAt,type:b.cancellation,
      feeCents:b.feeCents ?? 0,creditReturned:b.refunded ?? false,waiver:b.waiver ?? null,before:null,after:b,recordedFromBooking:true,mailSourceId:b.closureId ?? b.id,
      notice:{status:notice ? 'in_app' : 'not_recorded',mailStatus:null}});
  }
  return actions.map(a => a.action === 'cancel' ? {...a,restoredAt:actions.find(r => r.action === 'restore' && (r.cancellationId === a.id || (a.recordedFromBooking && r.bookingId === a.bookingId && r.before?.cancelledAt === a.at)))?.at ?? null} : a);
}

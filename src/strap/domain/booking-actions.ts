import { assertGuestTarget, guestLedger, restoreGuest } from './guest-bookings';
import { canManageGuest } from './guest-consent';
import { humanOwner, id, insist, integer, list, now, person, record, text, type RecordData } from './types';
import type { Transaction } from './store';
import { acknowledged } from './bookings';
import { cancelTerms, cancellationEffect, insistBookingOpen, priorityOnly } from './booking-policy';
import { appendPackEvent, planBlock, packServiceEligible } from './pack-credits';
import { countsCredits } from './entitlements';
import { chooseSpot, seatCapacity } from './spots';
import { promote } from './waitlist';
import { actionChannel, bookingHistory, staffReason } from './booking-history';

function futureClass(tx: Transaction, classId: unknown) {
  const entry = record(tx.state,classId,'class');
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409);
  tx.future(entry.start); return entry;
}
function availablePack(tx: Transaction, booking: RecordData, entry: RecordData, needsAvailable: boolean) {
  if (booking.guestPackId) return assertGuestTarget(tx,booking,entry);
  if (!booking.packId) { insist(booking.unpaid,'eligible_credit_required',409); return null; }
  const pack = record(tx.state,booking.packId,'pack');
  insist(pack.personId === booking.personId && packServiceEligible(pack,entry) && pack.expiresAt > entry.start && pack.expiresAt > now()
    && (!needsAvailable || !countsCredits(pack) || pack.remaining > 0) && (!priorityOnly(tx.state,entry,pack) || pack.priorityBooking === true),'pack_not_eligible',409);
  // PLAN-002: the same visit carries over only into a class its plan allows.
  const refusal = planBlock(tx.state,pack,entry,booking.id);
  insist(!refusal,refusal!,409);
  tx.future(pack.expiresAt); return pack;
}
/** A target must meet every ordinary eligibility fence; only capacity can be overridden. */
function target(tx: Transaction, booking: RecordData, entry: RecordData, input: Record<string,unknown>, needsAvailable: boolean, heldOffer = false) {
  person(tx.state,booking.personId);
  insist(acknowledged(tx.state,booking.personId),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.id !== booking.id && b.personId === booking.personId && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  const pack = availablePack(tx,booking,entry,needsAvailable);
  insistBookingOpen(tx,entry,pack?.priorityBooking === true,pack);
  if (!heldOffer) promote(tx,entry);
  const capacity = seatCapacity(tx.state,entry), override = input.override === undefined || input.override === '' ? null : text(input.override,'override_reason',500);
  const full = (tx.who.role === 'owner' ? capacity.totalOpen : capacity.onlineOpen) === 0;
  const spot = !full ? chooseSpot(tx.state,entry,input.spot) : override && input.spot ? chooseSpot(tx.state,entry,input.spot) : null;
  return {pack,full,spot,capacityPool:tx.who.role === 'owner' && (capacity.heldOpen > 0 || full) ? 'held' : 'online',override:full && override ? {by:tx.who.id,role:tx.who.role,right:'override',reason:override,bypassed:[`class full (${capacity.booked} of ${capacity.total})`],at:now()} : null};
}
/** The late/early choice uses the same terms key as cancellation. A move always
 * carries the reserved credit; an assessed monetary penalty is separate. */
function movePenalty(tx: Transaction, booking: RecordData, entry: RecordData, input: Record<string,unknown>) {
  const effect = cancellationEffect(booking,entry);
  if (input.terms !== undefined) insist(input.terms === effect.key,'cancellation_terms_changed',409);
  if (effect.timing === 'early') tx.future(effect.cutoffAt); else tx.reached(effect.cutoffAt);
  const staff = tx.who.role === 'owner';
  if (!staff) insist(input.mode === undefined || input.mode === 'late','fee_waiver_right_required',403);
  const mode = effect.waivable && staff ? text(input.mode,'cancel_choice',10) : effect.timing;
  insist(mode === 'early' || mode === 'late','invalid_cancel_choice');
  const waiver = effect.waivable && mode === 'early' ? {reason:text(input.reason,'waiver_reason',500),by:tx.who.id,right:'fee-waiver',waivedFeeCents:effect.feeCents,creditCarried:true,at:now()} : null;
  return {mode,feeCents:mode === 'late' ? effect.feeCents : 0,waiver};
}
export function moveBooking(tx: Transaction, input: Record<string,unknown>) {
  insist(['owner','member','instructor'].includes(tx.who.role),'forbidden',403);
  if (tx.who.role !== 'owner') insist(!input.override && !input.suppressNotice,'override_right_required',403);
  if (tx.who.role !== 'owner' && input.requestId) {
    const basis = JSON.stringify(Object.keys(input).sort().map(key => [key,input[key]]));
    const prior = list(tx.state,'bookingAction').find(a => a.actorId === tx.who.id && a.requestId === input.requestId);
    if (prior) { insist(prior.action === 'move' || prior.action === 'waitlist','booking_request_changed',409); insist(prior.requestBasis === basis,'booking_request_changed',409); return prior.after; }
  }
  return performMove(tx,input);
}
function performMove(tx: Transaction, input: Record<string,unknown>, heldOffer = false) {
  const staff = tx.who.role === 'owner';
  const booking = record(tx.state,input.id,'booking'), source = futureClass(tx,booking.classId), entry = futureClass(tx,input.classId);
  insist(booking.status === 'booked' && !booking.attendance && !booking.checkedInAt,'unstarted_confirmed_booking_required',409);
  insist(source.id !== entry.id,'different_class_required');
  if (staff) { staffReason(tx,input); actionChannel(input); }
  else insist((tx.who.personId === booking.personId || (booking.guestPackId && canManageGuest(tx.state,tx.who,booking))) && ['member','instructor'].includes(tx.who.role),'forbidden',403);
  const to = target(tx,booking,entry,input,false,heldOffer);
  if (to.full && !to.override) {
    insist(!list(tx.state,'booking').some(b => b.moveFromBookingId === booking.id && b.classId === entry.id && b.status !== 'cancelled'),'already_waitlisted',409);
    const waiter = {...(booking.guestPackId ? {guestPackId:booking.guestPackId,sponsorId:booking.sponsorId,payerId:booking.payerId,guestFunding:booking.guestFunding,guestPriceCents:booking.guestPriceCents} : {}),id:id(),personId:booking.personId,classId:entry.id,moveFromBookingId:booking.id,moveRequest:staff ? {cancelReason:input.cancelReason,channel:actionChannel(input)} : {},status:'waitlisted',capacityPool:'online',bookingChannel:staff ? actionChannel(input) : 'online',
      madeBy:tx.who.id,madeByRole:tx.who.role,right:'booking',cancelTerms:cancelTerms(tx.state,entry,to.pack),createdAt:now(),sequence:tx.state.version+1};
    tx.put('booking',waiter);
    bookingHistory(tx,'waitlist',booking,waiter,input,{keptBookingId:booking.id}); return waiter;
  }
  const penalty = movePenalty(tx,booking,source,input);
  const moved = {...booking,classId:entry.id,spot:to.spot,capacityPool:to.capacityPool,cancelTerms:cancelTerms(tx.state,entry,to.pack),
    movedAt:now(),movedBy:tx.who.id,bookingChannel:staff ? actionChannel(input) : 'online',override:to.override,feeCents:penalty.feeCents};
  if (booking.packId) appendPackEvent(tx,to.pack!,{type:'transfer',credits:0,bookingId:booking.id,classId:entry.id,reason:`Moved from ${source.id}`});
  if (booking.guestPackId) guestLedger(tx,moved,'transfer');
  tx.put('booking',moved);
  for (const pending of list(tx.state,'booking').filter(b => b.moveFromBookingId === booking.id && b.status !== 'cancelled')) {
    tx.put('booking',{...pending,status:'cancelled',cancellation:'move_replaced',cancelledAt:now(),cancelledBy:tx.who.id,cancelledByRole:tx.who.role});
    if (pending.classId !== entry.id) promote(tx,record(tx.state,pending.classId,'class'));
  }
  const action = bookingHistory(tx,'move',booking,moved,input,{type:penalty.mode,waiver:penalty.waiver,acceptedOfferId:input.acceptedOfferId ?? null});
  if (penalty.feeCents) tx.put('charge',{id:id(),personId:booking.personId,bookingId:booking.id,classId:source.id,amountCents:penalty.feeCents,reason:'late_move_fee',bookingActionId:action.id,createdAt:now(),createdBy:tx.who.id});
  promote(tx,source); return moved;
}
export function restoreBooking(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const booking = record(tx.state,input.id,'booking'), entry = futureClass(tx,booking.classId);
  insist(booking.status === 'cancelled' && ['early','late'].includes(booking.cancellation),'cancellation_not_restorable',409);
  const reason = text(input.reason,'restore_reason',500), to = target(tx,booking,entry,input,booking.refunded === true);
  insist(!to.full || to.override,'class_full',409);
  if (booking.refunded && to.pack && !booking.guestPackId) appendPackEvent(tx,to.pack,{type:'reserve',credits:countsCredits(to.pack) ? -1 : 0,bookingId:booking.id,classId:entry.id,reason:'cancellation_restored'});
  const charges = list(tx.state,'charge').filter(c => c.bookingId === booking.id), fees = charges.filter(c => c.reason === 'late_cancel_fee' && (!booking.cancellationId || c.cancellationId === booking.cancellationId) && !charges.some(r => r.reversesChargeId === c.id));
  for (const fee of fees) tx.put('charge',{id:id(),personId:booking.personId,bookingId:booking.id,classId:entry.id,amountCents:-fee.amountCents,reason:'fee_reversal',reversesChargeId:fee.id,note:reason,createdAt:now(),createdBy:tx.who.id});
  const {cancelledAt,cancelledBy,cancelledByRole,cancellation,refunded,feeCents,waiver,cancellationId,...active} = booking;
  const restored = {...active,status:'booked',restoredAt:now(),restoredBy:tx.who.id,spot:to.spot,capacityPool:to.capacityPool,override:to.override};
  if (!booking.refunded && to.pack && !booking.guestPackId) appendPackEvent(tx,to.pack,{type:'reserve',credits:0,bookingId:booking.id,classId:entry.id,reason:'cancellation_restored'});
  if (booking.guestPackId) restoreGuest(tx,restored);
  tx.put('booking',restored);
  bookingHistory(tx,'restore',booking,restored,input,{cancellationId:cancellationId ?? null,feeReversedCents:fees.reduce((sum,c) => sum+c.amountCents,0)}); return restored;
}
/** Chosen position is an explicit owner override; stable ordering survives all later joins. */
export function positionWaiter(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const booking = record(tx.state,input.id,'booking'); futureClass(tx,booking.classId);
  insist(booking.status === 'waitlisted','waitlisted_booking_required',409);
  const reason = text(input.reason,'override_reason',500), waiters = list(tx.state,'booking').filter(b => b.classId === booking.classId && b.status === 'waitlisted' && b.id !== booking.id).sort((a,b) => a.sequence-b.sequence || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const position = integer(input.position,'position',1,waiters.length+1);
  waiters.splice(position-1,0,booking);
  for (let index = 0; index < waiters.length; index++) tx.put('booking',{...waiters[index],sequence:index+1});
  // Future joins use the revision + 1, always after these positions.
  const after = record(tx.state,booking.id,'booking');
  bookingHistory(tx,'position',booking,after,input,{position,reason,overrideRight:'override'}); return after;
}

/** A vacancy holds a claim, never silently cancels the original seat. The
 * current source effect must be explicitly confirmed at acceptance. */
export function acceptPendingMove(tx: Transaction, waiter: RecordData, input: Record<string,unknown>) {
  const source = record(tx.state,waiter.moveFromBookingId,'booking'), entry = record(tx.state,source.classId,'class');
  const effect = cancellationEffect(source,entry);
  insist(text(input.terms,'terms',40) === effect.key,'cancellation_terms_changed',409);
  tx.put('booking',{...waiter,status:'cancelled',cancellation:'move_completed',cancelledAt:now(),cancelledBy:tx.who.id,cancelledByRole:tx.who.role});
  return performMove(tx,{...waiter.moveRequest,...input,id:source.id,classId:waiter.classId,acceptedOfferId:waiter.id},true);
}

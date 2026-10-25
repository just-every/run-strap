import { debtorOf } from './households';
import { humanOwner, id, instant, insist, integer, list, now, person, record, text, type RecordData } from './types';
import type { Transaction } from './store';
import { acknowledged, bookingPack, planRefused, seat } from './bookings';
import { bookingWindow, cancelTerms, classService, insistBookingOpen, priorityOnly } from './booking-policy';
import { appendPackEvent, packCanSeat, packServiceEligible } from './pack-credits';
import { countsCredits } from './entitlements';
import { chooseSpot, seatCapacity } from './spots';
import { bookingHistory } from './booking-history';
import { promote } from './waitlist';

// SCHED-010 front-desk booking. Until STAFF-001 the human owner operates the
// desk and alone holds the booking and override rights. A desk booking names
// how the visit is paid: the earliest-expiring eligible credit (auto), a chosen
// eligible pack, a drop-in or pack sold in the same checkout, or an unpaid
// visit. A sale creates the member's pack, its charge and, with a reference, a
// payment recorded as received outside Strap (never a card charge: BILL-002
// carries cards and phone payment links). A drop-in is one credit for this
// class's service that ends when the class ends. An unpaid visit holds a seat
// with no credit; the member's next purchased pack (not a drop-in) that is
// eligible for it settles it once, earliest class first, with one debit.
// Without the override, desk bookings keep the member fences (waiver,
// duplicate, booking window, capacity, credit); with an override reason the
// owner books past a full roster or outside the window, and the booking keeps
// who overrode, the reason and each bypassed policy.
const pays = ['auto','pack','drop-in','sell-pack','unpaid'];

function usable(tx: Transaction, pack: RecordData, personId: string, entry: RecordData) {
  return pack.personId === personId && packCanSeat(tx.state,pack,entry) && packServiceEligible(pack,entry) && pack.expiresAt > entry.start && pack.expiresAt > now()
    && (!priorityOnly(tx.state,entry,pack) || pack.priorityBooking === true);
}

function sell(tx: Transaction, personId: string, entry: RecordData, dropIn: boolean, input: Record<string,unknown>) {
  const credits = dropIn ? 1 : integer(input.credits,'credits',1,10_000);
  const amountCents = integer(input.amountCents,'amountCents',0,100_000_000);
  const expiresAt = dropIn ? entry.end : instant(input.expiresAt,'expiresAt');
  insist(expiresAt > entry.start && expiresAt > now(),'sale_must_cover_this_class');
  tx.future(expiresAt);
  const pack = {id:id(),personId,kind:dropIn ? 'drop-in' : 'pack',eligibleServices:dropIn ? [classService(entry)] : [],priorityBooking:false,creditLedgerVersion:1,creditRevision:0,
    credits,remaining:0,amountCents,expiresAt,soldAtDesk:true,soldBy:tx.who.id,createdAt:now()};
  tx.put('pack',pack);
  appendPackEvent(tx,pack,{type:'grant',credits});
  tx.put('charge',{id:id(),personId:debtorOf(tx.state,personId),...(debtorOf(tx.state,personId) === personId ? {} : {forPersonId:personId}),packId:pack.id,amountCents,createdAt:now(),createdBy:tx.who.id});
  if (input.reference !== undefined && input.reference !== '') {
    const reference = text(input.reference,'reference',160);
    insist(!list(tx.state,'payment').some(p => p.reference === reference),'payment_reference_used',409);
    tx.put('payment',{id:id(),personId,amountCents,reference,packId:pack.id,createdAt:now(),recordedBy:tx.who.id});
  }
  if (!dropIn) settleUnpaid(tx,record(tx.state,pack.id,'pack'));
  return record(tx.state,pack.id,'pack');
}

/** The next eligible purchase settles each unpaid visit once, earliest first. */
export function settleUnpaid(tx: Transaction, pack: RecordData) {
  if (pack.kind === 'drop-in') return;
  const classes = new Map(list(tx.state,'class').map(c => [c.id,c]));
  const open = list(tx.state,'booking').filter(b => b.personId === pack.personId && b.status === 'booked' && b.unpaid && !b.packId && b.attendance !== 'excused')
    .sort((a,b) => classes.get(a.classId)!.start.localeCompare(classes.get(b.classId)!.start) || a.id.localeCompare(b.id));
  for (const visit of open) {
    const entry = classes.get(visit.classId)!, current = record(tx.state,pack.id,'pack');
    if (!packCanSeat(tx.state,current,entry) || !packServiceEligible(current,entry) || current.expiresAt <= entry.start) continue;
    appendPackEvent(tx,current,{type:'reserve',credits:countsCredits(current) ? -1 : 0,bookingId:visit.id,classId:entry.id,reason:'unpaid_visit_settled'});
    if (visit.attendance === 'attended' || visit.attendance === 'no_show') appendPackEvent(tx,current,{type:'consume',credits:0,bookingId:visit.id,classId:entry.id,reason:'unpaid_visit_settled'});
    tx.put('booking',{...visit,packId:pack.id,settledAt:now(),settledByPackId:pack.id});
  }
}

export function deskBook(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId), entry = record(tx.state,input.classId,'class');
  insist(!entry.privatePersonId,'private_appointment_desk_review_required',403);
  insist(member.role === 'member','member_required');
  insist(entry.status !== 'cancelled','class_cancelled',409);
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409);
  tx.future(entry.start);
  const channel = text(input.channel ?? 'desk','channel',30);
  insist(['desk','phone','inbox'].includes(channel),'invalid_channel');
  const pay = text(input.pay ?? 'auto','pay',20);
  insist(pays.includes(pay),'invalid_pay');
  const override = input.override === undefined || input.override === '' ? null : text(input.override,'override_reason',500);
  insist(acknowledged(tx.state,member.id),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.personId === member.id && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  const bypassed: string[] = [];
  const sold = pay === 'drop-in' || pay === 'sell-pack' ? sell(tx,member.id,entry,pay === 'drop-in',input) : null;
  const chosen = pay === 'pack' ? record(tx.state,input.packId,'pack') : null;
  // The booking window, as members meet it (the paying plan's rule first), unless the owner overrides it.
  const planned = sold ?? chosen ?? (pay === 'auto' ? bookingPack(tx.state,member.id,entry) : null);
  const window = bookingWindow(tx.state,entry,planned), at = now();
  const priority = sold ? false : planned?.priorityBooking === true;
  const opensAt = priority && window.priorityOpensAt ? window.priorityOpensAt : window.opensAt;
  const outside = at >= window.closesAt ? `booking window closed at ${window.closesAt}` : opensAt && at < opensAt ? `booking window opens at ${opensAt}` : null;
  if (outside && override) { bypassed.push(outside); if (at >= window.closesAt) tx.reached(window.closesAt); else tx.future(opensAt!); }
  else insistBookingOpen(tx,entry,priority,planned);
  // Existing eligible online waiters keep priority over an unallocated online seat.
  promote(tx,entry);
  const capacity = seatCapacity(tx.state,entry);
  const base = {id:id(),classId:entry.id,personId:member.id,status:'waitlisted',bookingChannel:channel,madeBy:tx.who.id,madeByRole:tx.who.role,right:'booking',
    cancelTerms:cancelTerms(tx.state,entry,planned),createdAt:now(),sequence:tx.state.version+1};
  if (capacity.totalOpen === 0 && !override) {
    // MSG-004: a full class takes the member onto the end of its online waitlist.
    insist(input.waitlist === true,'class_full',409);
    const waiter = {...base,capacityPool:'online'}; tx.put('booking',waiter); bookingHistory(tx,'waitlist',waiter,waiter,input); return waiter;
  }
  if (capacity.totalOpen === 0) bypassed.push(`class full (${capacity.booked} of ${capacity.total})`);
  if (chosen) insist(usable(tx,chosen,member.id,entry),'pack_not_eligible',409);
  const pack = planned;
  insist(pack || pay === 'unpaid',(pay === 'auto' ? planRefused(tx.state,member.id,entry)?.code : null) ?? 'eligible_credit_required',409);
  // Past a full roster a spot is assigned only when one is named and free.
  const spot = capacity.totalOpen === 0 ? (input.spot ? chooseSpot(tx.state,entry,input.spot) : null) : chooseSpot(tx.state,entry,input.spot);
  const booking = {...base,capacityPool:capacity.heldOpen > 0 || capacity.totalOpen === 0 ? 'held' : 'online',payment:pay,...(sold ? {soldPackId:sold.id} : {}),
    ...(bypassed.length ? {override:{by:tx.who.id,role:tx.who.role,right:'override',reason:override,bypassed,at:now()}} : {})};
  if (pack) return seat(tx,booking,entry,pack,spot);
  const visit = {...booking,status:'booked',unpaid:true,packId:null,bookedAt:now(),...(spot ? {spot} : {})};
  tx.put('booking',visit); return visit;
}

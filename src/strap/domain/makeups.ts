import { humanOwner, id, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { acknowledged } from './bookings';
import { cancelTerms, cancellationEffect, classService, insistBookingOpen } from './booking-policy';
import { bookingCredit, serviceKey } from './pack-credits';
import { chooseSpot, seatCapacity } from './spots';
import { promote } from './waitlist';
import { canManageMakeup, authorizeMakeup, makeupNotice } from './makeup-authority';
import { appendPackEvent } from './pack-credits';
import { requestBasis, staffChannel } from './staff-actions';

export function saveAbsencePolicy(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const service = text(input.service,'service',100), key = `absence-policy:${serviceKey(service)}`;
  const previous = tx.state.records.get(key)?.data;
  const capped = input.maxCredits !== undefined && input.maxCredits !== '';
  const maxCredits = capped ? integer(input.maxCredits,'maxCredits',1,365) : null;
  const capDays = capped ? integer(input.capDays,'capDays',1,365) : null;
  insist(capped || input.capDays === undefined || input.capDays === '' || input.capDays === null,'maxCredits_required');
  const policy = {id:key,service,maxCredits,capDays,noticeHours:integer(input.noticeHours,'noticeHours',0,8760),expiryDays:integer(input.expiryDays,'expiryDays',1,365),active:input.active !== false,revision:(previous?.revision ?? 0)+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('absencePolicy',policy); return policy;
}
function absenceFacts(tx: Transaction, input: Record<string,unknown>) {
  const original = record(tx.state,input.id,'booking'); authorizeMakeup(tx,original.personId);
  const reason = text(input.reason,'reason',500), requestId = text(input.requestId,'requestId',100);
  const entry = record(tx.state,original.classId,'class');
  const policy = tx.state.records.get(`absence-policy:${serviceKey(classService(entry))}`)?.data;
  const pack = original.packId ? record(tx.state,original.packId,'pack') : null;
  insist(policy?.active,'absence_not_eligible',409);
  insist(original.status === 'booked' && pack && pack.amountCents > 0 && !original.guestPackId && !original.unpaid && !original.makeupCreditId && !original.checkedInAt && !original.attendance,'absence_not_eligible',409);
  insist(entry.status === 'published','absence_not_eligible',409);
  const cutoff = new Date(Date.parse(entry.start)-policy.noticeHours*3600000).toISOString();
  insist(cutoff > now(),'absence_notice_closed',409); tx.future(cutoff);
  if (policy.maxCredits) {
    const since = new Date(Date.now()-policy.capDays*86400000).toISOString();
    const issued = list(tx.state,'makeupCredit').filter(c => c.personId === original.personId && !c.voidedAt && c.issuedAt > since && serviceKey(c.service) === serviceKey(policy.service));
    insist(issued.length < policy.maxCredits,'absence_credit_cap_reached',409);
  }
  return {original,entry,policy,reason,requestId};
}
const absenceBasis = (f: ReturnType<typeof absenceFacts>) => JSON.stringify({original:f.original,entry:f.entry,policy:f.policy,reason:f.reason});
export function previewAbsence(tx: Transaction, input: Record<string,unknown>) {
  const f = absenceFacts(tx,input), previewId = id();
  const preview = {id:previewId,key:id(),actorId:tx.who.id,originalBookingId:f.original.id,personId:f.original.personId,reason:f.reason,requestId:f.requestId,channel:tx.who.role === 'owner' ? staffChannel(input) : 'member',basis:absenceBasis(f),cancellationEffect:cancellationEffect(f.original,f.entry),expiresAt:new Date(Math.min(Date.now()+15*60000,Date.parse(f.entry.start)-f.policy.noticeHours*3600000)).toISOString(),status:'preview',createdAt:now()};
  tx.put('absencePreview',preview); return preview;
}
export function reportAbsence(tx: Transaction, input: Record<string,unknown>) {
  const original = record(tx.state,input.id,'booking'); authorizeMakeup(tx,original.personId);
  const reason = text(input.reason,'reason',500), requestId = text(input.requestId,'requestId',100);
  const prior = list(tx.state,'absence').find(a => a.originalBookingId === original.id);
  if (prior) { insist(prior.reason === reason && !prior.restoredAt,'absence_request_changed',409); return prior; }
  const f = absenceFacts(tx,input), {entry,policy} = f;
  let preview: RecordData | null = null;
  if (input.previewId) {
    preview = record(tx.state,input.previewId,'absencePreview');
    insist(preview.actorId === tx.who.id && preview.originalBookingId === original.id,'makeup_not_found',404);
    insist(input.key === preview.key && preview.status === 'preview' && preview.expiresAt > now() && preview.basis === absenceBasis(f),'absence_preview_changed',409);
    tx.future(preview.expiresAt);
  }
  const at = now(), creditId = id(), absence = {id:id(),personId:original.personId,originalBookingId:original.id,classId:entry.id,reason,requestId,policy:{...policy},creditId,at,actorId:tx.who.id,actorRole:tx.who.role,channel:tx.who.role === 'owner' ? staffChannel(input) : 'member',originalOutcome:{status:original.status,attendance:original.attendance ?? null,packId:original.packId}};
  tx.put('absence',absence);
  tx.put('makeupCredit',{id:creditId,personId:original.personId,absenceId:absence.id,originalBookingId:original.id,service:policy.service,issuedAt:at,expiresAt:new Date(Date.parse(entry.start)+policy.expiryDays*86400000).toISOString(),bookingId:null});
  bookingCredit(tx,original,{type:'consume',credits:0,bookingId:original.id,classId:entry.id,reason:'absence'});
  tx.put('booking',{...original,status:'cancelled',cancellation:'absence',attendance:'absence',absenceId:absence.id,cancelledAt:at,cancelledBy:tx.who.id,cancelledByRole:tx.who.role,refunded:false});
  if (preview) tx.put('absencePreview',{...preview,status:'reported',absenceId:absence.id});
  makeupNotice(tx,original.personId,{id:`absence:${absence.id}`,bookingIds:[original.id],subject:'Absence recorded',body:`Your absence is recorded. One makeup credit expires ${new Date(Date.parse(entry.start)+policy.expiryDays*86400000).toISOString()}. Your original visit stays used.`});
  promote(tx,entry); return absence;
}
/** Restoring the original allocation voids only an unused makeup grant. */
export function restoreAbsence(tx: Transaction, booking: RecordData, entry: RecordData, placement: {spot: unknown;capacityPool: unknown;override: unknown}, input: Record<string,unknown>) {
  humanOwner(tx.who); const reason = text(input.reason,'restore_reason',500);
  insist(booking.cancellation === 'absence' && booking.status === 'cancelled' && entry.start > now(),'cancellation_not_restorable',409); tx.future(entry.start);
  const absence = record(tx.state,booking.absenceId,'absence'), credit = record(tx.state,absence.creditId,'makeupCredit');
  insist(!credit.bookingId && !credit.reservedAt && !credit.voidedAt && !absence.restoredAt,'makeup_credit_used',409);
  const at = now();
  tx.put('makeupCredit',{...credit,voidedAt:at,voidedBy:tx.who.id,voidReason:reason});
  tx.put('absence',{...absence,restoredAt:at,restoredBy:tx.who.id,restoreReason:reason});
  const {attendance,cancellation,absenceId,cancelledAt,cancelledBy,cancelledByRole,refunded,...active} = booking;
  const restored = {...active,status:'booked',restoredAt:at,restoredBy:tx.who.id,spot:placement.spot,capacityPool:placement.capacityPool,override:placement.override};
  appendPackEvent(tx,record(tx.state,booking.packId,'pack'),{type:'reserve',credits:0,bookingId:booking.id,classId:entry.id,reason:'absence_restored'});
  tx.put('booking',restored);
  makeupNotice(tx,booking.personId,{id:`absence-restored:${absence.id}`,bookingIds:[booking.id],subject:'Absence restored',body:'Your original class is booked again. Its original visit stays reserved and the unused makeup credit was voided.'});
  return restored;
}
/** Hook for moves/restores: ordinary capacity, waiver, duplicates and window
 * remain the caller's responsibility. This checks the special allocation. */
export function assertMakeupTarget(tx: Transaction, booking: RecordData, entry: RecordData, needsAvailable = false) {
  const credit = record(tx.state,booking.makeupCreditId,'makeupCredit');
  insist(!credit.voidedAt,'makeup_credit_voided',409);
  insist(entry.id !== record(tx.state,credit.originalBookingId,'booking').classId,'different_class_required',409);
  insist(credit.personId === booking.personId && serviceKey(credit.service) === serviceKey(classService(entry)),'makeup_not_eligible',409);
  insist(credit.expiresAt > now() && credit.expiresAt > entry.start,'makeup_expired',409); tx.future(credit.expiresAt);
  insist((!credit.bookingId || credit.bookingId === booking.id) && (!needsAvailable || !credit.bookingId || credit.bookingId === booking.id),'makeup_credit_used',409);
  return credit;
}
export function reserveMakeupCredit(tx: Transaction, booking: RecordData) {
  const credit = assertMakeupTarget(tx,booking,record(tx.state,booking.classId,'class'),true);
  if (credit.bookingId === booking.id) return credit;
  const held = {...credit,bookingId:booking.id,reservedAt:now()}; tx.put('makeupCredit',held); return held;
}
/** Call only when policy returns the allocation (early cancel, closure,
 * excused correction). Late cancellation retains it for restore. */
export function releaseMakeupCredit(tx: Transaction, booking: RecordData) {
  const credit = record(tx.state,booking.makeupCreditId,'makeupCredit');
  insist(credit.personId === booking.personId,'makeup_not_found',404);
  if (credit.bookingId !== booking.id) return credit;
  const released = {...credit,bookingId:null,releasedAt:now()}; tx.put('makeupCredit',released); return released;
}
export function bookMakeup(tx: Transaction, input: Record<string,unknown>) {
  const credit = record(tx.state,input.creditId,'makeupCredit'); authorizeMakeup(tx,credit.personId);
  const requestId = text(input.requestId,'requestId',100), basis = requestBasis(input);
  const replay = list(tx.state,'booking').find(b => b.makeupCreditId === credit.id && b.makeupRequestId === requestId && b.madeBy === tx.who.id);
  if (replay) { insist(replay.makeupRequestBasis === basis,'makeup_request_changed',409); return replay; }
  const entry = record(tx.state,input.classId,'class');
  const booking = {id:id(),personId:credit.personId,classId:entry.id,makeupCreditId:credit.id,originalBookingId:credit.originalBookingId,status:'booked',capacityPool:'online',bookingChannel:tx.who.role === 'owner' ? staffChannel(input) : 'online',madeBy:tx.who.id,madeByRole:tx.who.role,makeupRequestId:requestId,makeupRequestBasis:basis,cancelTerms:cancelTerms(tx.state,entry),createdAt:now(),bookedAt:now(),sequence:tx.state.version+1};
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409); tx.future(entry.start);
  assertMakeupTarget(tx,booking,entry,true);
  insist(acknowledged(tx.state,credit.personId),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.personId === credit.personId && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  insistBookingOpen(tx,entry,false); promote(tx,entry);
  insist(seatCapacity(tx.state,entry).onlineOpen > 0,'class_full',409);
  const spot = chooseSpot(tx.state,entry,input.spot), seated = {...booking,...(spot ? {spot} : {})};
  reserveMakeupCredit(tx,seated); tx.put('booking',seated);
  makeupNotice(tx,credit.personId,{id:`makeup-booked:${seated.id}`,bookingIds:[seated.id],subject:'Makeup booking confirmed',body:'Your replacement class is booked using the linked makeup credit. Your original absence remains recorded.'}); return seated;
}
export function makeupSnapshot(state: State, who: Actor) {
  const visible = (r: RecordData) => canManageMakeup(state,who,r.personId);
  const reportable = (b: RecordData) => {
    if (b.status !== 'booked' || !b.packId || b.attendance || b.checkedInAt || b.guestPackId || b.unpaid || list(state,'absence').some(a => a.originalBookingId === b.id)) return false;
    const pack = state.records.get(b.packId)?.data, entry = state.records.get(b.classId)?.data;
    if (!pack || !(pack.amountCents > 0) || !entry || entry.status !== 'published') return false;
    const policy = state.records.get(`absence-policy:${serviceKey(classService(entry))}`)?.data;
    return policy?.active && Date.parse(entry.start)-policy.noticeHours*3600000 > Date.now();
  };
  return {previews:list(state,'absencePreview').filter(p => p.actorId === who.id && visible(p)),participants:state.people.filter(p=>canManageMakeup(state,who,p.id)).map(p=>({id:p.id,name:p.name})),policies:who.role === 'owner' || who.role === 'member' ? list(state,'absencePolicy') : [],
    guardians:list(state,'makeupGuardian').filter(r => (who.role === 'owner' && who.isOwner) || (who.role === 'member' && [r.personId,r.guardianId].includes(who.personId))).map(r => who.role === 'owner' ? r : {id:r.id,personId:r.personId,guardianId:r.guardianId,relationship:r.relationship,adultOn:r.adultOn,adultAt:r.adultAt,participantAcceptedAt:r.participantAcceptedAt,guardianAcceptedAt:r.guardianAcceptedAt,revokedAt:r.revokedAt}),
    credits:list(state,'makeupCredit').filter(visible),absences:list(state,'absence').filter(visible),
    bookings:list(state,'booking').filter(b => visible(b) && (b.makeupCreditId || b.absenceId || reportable(b))).map(b=>b.status==='booked' && record(state,b.classId,'class').start>now() ? {...b,cancelEffect:cancellationEffect(b,record(state,b.classId,'class'))}:b)};
}

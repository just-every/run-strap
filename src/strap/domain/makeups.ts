import { humanOwner, id, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { acknowledged } from './bookings';
import { cancelTerms, cancellationEffect, classService, insistBookingOpen } from './booking-policy';
import { bookingCredit, serviceKey } from './pack-credits';
import { chooseSpot, seatCapacity } from './spots';
import { promote } from './waitlist';
import { confirmBooking, putNotice, reserveMail } from './notices';
import { requestBasis, staffChannel } from './staff-actions';

// Deliberately limited authority: this relationship opens makeup records only,
// never a household, payer, health record, profile or general account snapshot.
// Legal guardian grants require owner-verified youth/legal evidence and guardian
// acceptance; adult delegation additionally requires participant acceptance.
export function canManageMakeup(state: State, who: Actor, personId: string) {
  if (who.role === 'owner' && who.isOwner) return true;
  if (who.role !== 'member' || !who.personId) return false;
  if (!state.people.some(p => p.id === personId && p.active && !p.erasedAt)) return false;
  return who.personId === personId || list(state,'makeupGuardian').some(r => r.personId === personId && r.guardianId === who.personId && !r.revokedAt && (r.relationship === 'legal-guardian' || r.participantAcceptedAt) && r.guardianAcceptedAt);
}
const authorize = (tx: Transaction, personId: string) => { person(tx.state,personId); insist(canManageMakeup(tx.state,tx.who,personId),'makeup_not_found',404); };
export function saveAbsencePolicy(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const service = text(input.service,'service',100), key = `absence-policy:${serviceKey(service)}`;
  const previous = tx.state.records.get(key)?.data;
  const policy = {id:key,service,noticeHours:integer(input.noticeHours,'noticeHours',0,8760),expiryDays:integer(input.expiryDays,'expiryDays',1,365),active:input.active !== false,revision:(previous?.revision ?? 0)+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('absencePolicy',policy); return policy;
}
export function saveMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const participant = person(tx.state,input.personId), guardian = person(tx.state,input.guardianId);
  insist(participant.role === 'member' && guardian.role === 'member' && participant.id !== guardian.id,'invalid_makeup_guardian');
  text(input.authorizationEvidence,'authorizationEvidence',500);
  const prior = list(tx.state,'makeupGuardian').find(r => r.personId === participant.id && r.guardianId === guardian.id && !r.revokedAt);
  if (prior) return prior;
  const kind = text(input.relationship,'relationship',30), evidence = text(input.authorizationEvidence,'authorizationEvidence',500);
  insist(kind === 'legal-guardian' || kind === 'adult-delegate','invalid_relationship');
  const relationship = {id:id(),personId:participant.id,guardianId:guardian.id,relationship:kind,authorizationEvidence:evidence,youthVerified:kind === 'legal-guardian',createdAt:now(),createdBy:tx.who.id,participantAcceptedAt:null,guardianAcceptedAt:null,revokedAt:null};
  tx.put('makeupGuardian',relationship); return relationship;
}
export function acceptMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_required',403);
  const r = record(tx.state,input.id,'makeupGuardian');
  insist(!r.revokedAt && [r.personId,r.guardianId].includes(tx.who.personId),'makeup_not_found',404);
  person(tx.state,r.personId); person(tx.state,r.guardianId);
  const field = tx.who.personId === r.personId ? 'participantAcceptedAt' : 'guardianAcceptedAt';
  if (r[field]) return r;
  const updated = {...r,[field]:now(),[field.replace('At','By')]:tx.who.id}; tx.put('makeupGuardian',updated); return updated;
}
export function revokeMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  const r = record(tx.state,input.id,'makeupGuardian');
  insist((tx.who.role === 'owner' && tx.who.isOwner) || (tx.who.role === 'member' && [r.personId,r.guardianId].includes(tx.who.personId)),'makeup_not_found',404);
  if (r.revokedAt) return r;
  const updated = {...r,revokedAt:now(),revokedBy:tx.who.id}; tx.put('makeupGuardian',updated); return updated;
}
export function reportAbsence(tx: Transaction, input: Record<string,unknown>) {
  const original = record(tx.state,input.id,'booking'); authorize(tx,original.personId);
  const reason = text(input.reason,'reason',500), requestId = text(input.requestId,'requestId',100);
  const prior = list(tx.state,'absence').find(a => a.originalBookingId === original.id);
  if (prior) { insist(prior.reason === reason,'absence_request_changed',409); return prior; }
  const entry = record(tx.state,original.classId,'class');
  const policy = tx.state.records.get(`absence-policy:${serviceKey(classService(entry))}`)?.data;
  insist(policy?.active,'absence_not_eligible',409);
  insist(original.status === 'booked' && !!original.packId && !original.makeupCreditId && !original.checkedInAt && !original.attendance,'absence_not_eligible',409);
  insist(entry.status === 'published','absence_not_eligible',409);
  const cutoff = new Date(Date.parse(entry.start)-policy.noticeHours*3600000).toISOString();
  insist(cutoff > now(),'absence_notice_closed',409); tx.future(cutoff);
  const at = now(), creditId = id(), absence = {id:id(),personId:original.personId,originalBookingId:original.id,classId:entry.id,reason,requestId,policy:{...policy},creditId,at,actorId:tx.who.id,actorRole:tx.who.role,channel:tx.who.role === 'owner' ? staffChannel(input) : 'member',originalOutcome:{status:original.status,attendance:original.attendance ?? null,packId:original.packId}};
  tx.put('absence',absence);
  tx.put('makeupCredit',{id:creditId,personId:original.personId,absenceId:absence.id,originalBookingId:original.id,service:policy.service,issuedAt:at,expiresAt:new Date(Date.parse(entry.start)+policy.expiryDays*86400000).toISOString(),bookingId:null});
  // The original allocation stays spent. This is a separate makeup grant, not
  // an early cancellation refund or an attendance correction.
  bookingCredit(tx,original,{type:'consume',credits:0,bookingId:original.id,classId:entry.id,reason:'absence'});
  tx.put('booking',{...original,status:'cancelled',cancellation:'absence',attendance:'absence',absenceId:absence.id,cancelledAt:at,cancelledBy:tx.who.id,cancelledByRole:tx.who.role,refunded:false});
  const subject = 'Absence recorded', body = `Your absence is recorded. One makeup credit expires ${new Date(Date.parse(entry.start)+policy.expiryDays*86400000).toISOString()}. Your original visit stays used.`;
  putNotice(tx,{id:`notice:absence:${absence.id}`,personId:original.personId,bookingId:original.id,subject,body});
  reserveMail(tx,tx.notices,{id:`mail:absence:${absence.id}`,sourceKind:'booking_action',sourceId:absence.id,personId:original.personId,bookingIds:[original.id],subject,body});
  promote(tx,entry); return absence;
}
/** Hook for moves/restores: ordinary capacity, waiver, duplicates and window
 * remain the caller's responsibility. This checks the special allocation. */
export function assertMakeupTarget(tx: Transaction, booking: RecordData, entry: RecordData, needsAvailable = false) {
  const credit = record(tx.state,booking.makeupCreditId,'makeupCredit');
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
  const credit = record(tx.state,input.creditId,'makeupCredit'); authorize(tx,credit.personId);
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
  reserveMakeupCredit(tx,seated); tx.put('booking',seated); confirmBooking(tx,seated); return seated;
}
export function makeupSnapshot(state: State, who: Actor) {
  const visible = (r: RecordData) => canManageMakeup(state,who,r.personId);
  return {participants:state.people.filter(p=>canManageMakeup(state,who,p.id)).map(p=>({id:p.id,name:p.name})),policies:who.role === 'owner' || who.role === 'member' ? list(state,'absencePolicy') : [],
    guardians:list(state,'makeupGuardian').filter(r => (who.role === 'owner' && who.isOwner) || (who.role === 'member' && [r.personId,r.guardianId].includes(who.personId))).map(r => who.role === 'owner' ? r : {id:r.id,personId:r.personId,guardianId:r.guardianId,relationship:r.relationship,participantAcceptedAt:r.participantAcceptedAt,guardianAcceptedAt:r.guardianAcceptedAt,revokedAt:r.revokedAt}),
    credits:list(state,'makeupCredit').filter(visible),absences:list(state,'absence').filter(visible),
    bookings:list(state,'booking').filter(b => visible(b) && (b.makeupCreditId || b.absenceId || (b.status === 'booked' && b.packId && !b.attendance))).map(b=>b.status==='booked' && record(state,b.classId,'class').start>now() ? {...b,cancelEffect:cancellationEffect(b,record(state,b.classId,'class'))}:b)};
}

export function launchMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const relationship = record(tx.state,input.id,'makeupGuardian');
  return {id:id(),personId:relationship.personId,guardianId:relationship.guardianId,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fmakeups'};
}

import { id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { acknowledged } from './bookings';
import { cancelTerms, cancellationEffect, insistBookingOpen } from './booking-policy';
import { chooseSpot, seatCapacity } from './spots';
import { guestAllowanceSummary, guestPassRefusal } from './guest-allowances';
import { guestConsent, guestPayer, guestSponsor } from './guest-consent';
import { putNotice, reserveMail, titleOf, whenText } from './notices';

function facts(tx: Transaction, input: Record<string,unknown>) {
  const sponsor = guestSponsor(tx,input), guest = person(tx.state,input.guestId), pack = record(tx.state,input.packId,'pack'), entry = record(tx.state,input.classId,'class');
  insist(pack.personId === sponsor.id,'guest_pack_not_owned',403);
  insist(guest.id !== sponsor.id && guestConsent(tx.state,sponsor.id,guest.id),'guest_consent_required',403);
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409);
  insist(acknowledged(tx.state,guest.id),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.personId === guest.id && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  insistBookingOpen(tx,entry,pack.priorityBooking === true,pack);
  const refusal = guestPassRefusal(tx.state,pack,entry,guest.id);
  insist(!refusal || pack.guestTerms.excess === 'charge',refusal!,409);
  insist(seatCapacity(tx.state,entry).onlineOpen > 0,'class_full',409);
  const amountCents = refusal ? pack.guestTerms.priceCents : 0, payerId = text(input.payerId || sponsor.id,'payerId',100);
  guestPayer(tx.state,sponsor.id,payerId,amountCents,tx.who.role === 'owner' && amountCents > 0);
  return {sponsor,guest,pack,entry,amountCents,payerId,funding:refusal ? 'paid' : 'pass',refusal,cancelTerms:cancelTerms(tx.state,entry,pack)};
}
const basis = (tx: Transaction, f: ReturnType<typeof facts>) => JSON.stringify({sponsor:f.sponsor.id,guest:f.guest.id,guestVersion:f.guest.version,pack:f.pack,entry:f.entry,amountCents:f.amountCents,payerId:f.payerId,funding:f.funding,cancelTerms:f.cancelTerms,consents:list(tx.state,'guestConsent').filter(g => g.sponsorId === f.sponsor.id && [f.guest.id,f.payerId].includes(g.personId)),holds:list(tx.state,'booking').filter(b => b.guestPackId || b.classId === f.entry.id).map(b => [b.id,b.classId,b.status,b.personId,b.guestFunding])});
export function previewGuestBooking(tx: Transaction, input: Record<string,unknown>) {
  const f = facts(tx,input);
  const draft = {id:id(),personId:f.guest.id,sponsorId:f.sponsor.id,packId:f.pack.id,classId:f.entry.id,payerId:f.payerId,amountCents:f.amountCents,funding:f.funding,refusal:f.refusal,cancelTerms:f.cancelTerms,basis:basis(tx,f),createdAt:now(),actorId:tx.who.id,status:'preview'};
  tx.put('guestBookingDraft',draft); return draft;
}
export function bookGuest(tx: Transaction, input: Record<string,unknown>) {
  const draft = record(tx.state,input.id,'guestBookingDraft');
  insist(draft.actorId === tx.who.id,'forbidden',403);
  if (draft.status === 'booked') { insist(guestConsent(tx.state,draft.sponsorId,draft.personId),'guest_consent_required',403); return record(tx.state,draft.bookingId,'booking'); }
  const f = facts(tx,{...draft,guestId:draft.personId});
  insist(basis(tx,f) === draft.basis,'guest_preview_changed',409);
  insist(input.confirm === true,'explicit_confirmation_required');
  tx.future(f.entry.start); tx.future(f.pack.expiresAt);
  const spot = chooseSpot(tx.state,f.entry,input.spot);
  const booking = {id:id(),personId:f.guest.id,sponsorId:f.sponsor.id,guestPackId:f.pack.id,guestFunding:f.funding,payerId:f.payerId,guestPriceCents:f.amountCents,classId:f.entry.id,status:'booked',capacityPool:'online',bookingChannel:tx.who.role === 'owner' ? input.channel ?? 'desk' : 'online',cancelTerms:draft.cancelTerms,createdAt:now(),bookedAt:now(),sequence:tx.state.version+1,...(spot ? {spot} : {})};
  tx.put('booking',booking); guestLedger(tx,booking,'reserve');
  if (f.amountCents) tx.put('charge',{id:id(),personId:f.payerId,bookingId:booking.id,classId:f.entry.id,amountCents:f.amountCents,reason:'guest_drop_in',createdAt:now(),createdBy:tx.who.id});
  tx.put('guestBookingDraft',{...draft,status:'booked',bookingId:booking.id});
  const subject = `Guest booking confirmed: ${titleOf(f.entry)}`, body = `${subject}, ${whenText(tx.state,f.entry.start)}. ${f.funding === 'pass' ? 'One guest pass is reserved; your own credits are unchanged.' : `$${(f.amountCents/100).toFixed(2)} was added to the payer’s studio balance; no payment was collected.`}`;
  for (const personId of new Set([f.guest.id,f.sponsor.id,f.payerId])) {
    putNotice(tx,{id:`notice:guest:${booking.id}:${personId}`,personId,bookingId:booking.id,classId:f.entry.id,subject,body});
    reserveMail(tx,tx.notices,{id:`mail:guest:${booking.id}:${personId}`,sourceKind:'booking',sourceId:booking.id,personId,bookingIds:[booking.id],subject,body});
  }
  return booking;
}
export function assertGuestTarget(tx: Transaction, booking: RecordData, entry: RecordData) {
  const pack = record(tx.state,booking.guestPackId,'pack');
  insist(guestConsent(tx.state,booking.sponsorId,booking.personId),'guest_consent_required',403);
  const refusal = guestPassRefusal(tx.state,pack,entry,booking.personId,booking.id);
  if (booking.guestFunding === 'pass') insist(!refusal,refusal!,409);
  // A paid reservation carries its already-confirmed price; moving it never
  // silently spends a complimentary pass or changes its payer/price.
  guestPayer(tx.state,booking.sponsorId,booking.payerId,booking.guestPriceCents,tx.who.role === 'owner' && booking.guestPriceCents > 0);
  insistBookingOpen(tx,entry,pack.priorityBooking === true,pack);
  tx.future(pack.expiresAt); return pack;
}
export function guestLedger(tx: Transaction, booking: RecordData, type: string) {
  tx.put('guestPassEvent',{id:id(),personId:booking.sponsorId,guestId:booking.personId,packId:booking.guestPackId,bookingId:booking.id,classId:booking.classId,type,funding:booking.guestFunding,at:now(),actorId:tx.who.id,actorRole:tx.who.role});
}
export function releaseGuest(tx: Transaction, booking: RecordData) {
  guestLedger(tx,booking,'return');
  const charges = list(tx.state,'charge').filter(c => c.bookingId === booking.id);
  for (const charge of charges.filter(c => c.reason === 'guest_drop_in' && !charges.some(r => r.reversesChargeId === c.id))) tx.put('charge',{id:id(),personId:charge.personId,bookingId:booking.id,classId:booking.classId,amountCents:-charge.amountCents,reason:'guest_drop_in_reversal',reversesChargeId:charge.id,createdAt:now(),createdBy:tx.who.id});
}
export function restoreGuest(tx: Transaction, booking: RecordData) {
  guestLedger(tx,booking,'reserve');
  if (booking.guestPriceCents) tx.put('charge',{id:id(),personId:booking.payerId,bookingId:booking.id,classId:booking.classId,amountCents:booking.guestPriceCents,reason:'guest_drop_in',createdAt:now(),createdBy:tx.who.id});
}
export function guestSnapshot(state: State, who: Actor) {
  const owner = who.role === 'owner', me = who.personId;
  const consents = list(state,'guestConsent').filter(g => owner || g.personId === me || g.sponsorId === me);
  const visible = new Set(consents.filter(g => g.active && g.sponsorId === me && g.type === 'guest').map(g => g.personId));
  const bookings = list(state,'booking').filter(b => b.guestPackId && (owner || b.personId === me || (b.sponsorId === me && visible.has(b.personId))));
  return {consents:consents.map(g => ({...g,name:!owner && g.personId !== me && !g.active ? 'Withdrawn person' : state.people.find(p => p.id === (g.personId === me ? g.sponsorId : g.personId))?.name ?? 'Former member'})),guests:state.people.filter(p => visible.has(p.id) && p.active && !p.erasedAt).map(p => ({id:p.id,name:p.name})),
    bookings:bookings.map(b => b.status === 'booked' && record(state,b.classId,'class').start > now() ? {...b,cancelEffect:cancellationEffect(b,record(state,b.classId,'class'))} : b),drafts:list(state,'guestBookingDraft').filter(d => d.actorId === who.id),events:list(state,'guestPassEvent').filter(e => owner || e.personId === me || e.guestId === me),
    allowances:list(state,'pack').filter(p => p.guestTerms && (owner || p.personId === me)).map(p => ({packId:p.id,personId:p.personId,...guestAllowanceSummary(state,p)}))};
}

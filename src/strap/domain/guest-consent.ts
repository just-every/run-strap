import { humanOwner, id, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';

/** Guests and payers themselves authorize a named member. Staff cannot consent
 * for either. No contact list or unrelated guest record is exposed. */
export function saveGuestConsent(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const email = text(input.sponsorEmail,'sponsor_email',254).toLowerCase();
  const sponsor = tx.state.people.find(p => p.email?.toLowerCase() === email && p.active && !p.erasedAt && p.role === 'member');
  const kind = input.kind ?? 'guest'; insist(kind === 'guest' || kind === 'payer','invalid_consent_kind');
  insist(sponsor && (sponsor.id !== tx.who.personId || kind === 'payer'),'sponsor_not_available',404);
  insist(input.consent === true,'explicit_consent_required');
  const prior = list(tx.state,'guestConsent').find(g => g.personId === tx.who.personId && g.sponsorId === sponsor.id && g.type === kind);
  const consent = {id:prior?.id ?? id(),type:kind,personId:tx.who.personId,sponsorId:sponsor.id,active:true,revision:(prior?.revision ?? 0)+1,
    maxChargeCents:kind === 'payer' ? integer(input.maxChargeCents,'max_guest_charge',0,100_000_000) : 0,at:now(),actorId:tx.who.id};
  tx.put('guestConsent',consent);
  tx.put('guestConsentEvent',{...consent,id:id(),consentId:consent.id}); return consent;
}
export function revokeGuestConsent(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const previous = record(tx.state,input.id,'guestConsent');
  insist(previous.personId === tx.who.personId,'forbidden',403);
  const consent = {...previous,active:false,revision:previous.revision+1,at:now(),actorId:tx.who.id};
  tx.put('guestConsent',consent); tx.put('guestConsentEvent',{...consent,id:id(),consentId:consent.id}); return consent;
}
export const guestConsent = (state: State, sponsorId: string, guestId: string) => list(state,'guestConsent').find(g => g.active && g.type === 'guest' && g.personId === guestId && g.sponsorId === sponsorId);
export function guestSponsor(tx: Transaction, input: Record<string,unknown>) {
  if (tx.who.role === 'owner') { humanOwner(tx.who); return person(tx.state,input.sponsorId); }
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403); return person(tx.state,tx.who.personId);
}
export function guestPayer(state: State, sponsorId: string, payerId: string, amountCents: number, requiresConsent = false) {
  person(state,payerId);
  if (payerId === sponsorId && !requiresConsent) return;
  const consent = list(state,'guestConsent').find(g => g.active && g.type === 'payer' && g.personId === payerId && g.sponsorId === sponsorId);
  insist(consent && consent.maxChargeCents >= amountCents,'guest_payer_consent_required',403);
}
export function canManageGuest(state: State, who: Actor, booking: RecordData) {
  return who.role === 'owner' || who.personId === booking.personId || (who.role === 'member' && who.personId === booking.sponsorId && !!guestConsent(state,booking.sponsorId,booking.personId));
}

export function launchGuestConsent(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); const member = person(tx.state,input.personId);
  text(input.requestId,'requestId',100);
  return {id:id(),personId:member.id,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fpacks%23guests'};
}

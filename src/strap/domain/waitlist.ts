import { intakeMissing } from './intake';
import { assertMakeupTarget } from './makeups';
import { canManageMakeup, authorizeMakeup } from './makeup-authority';
import { assertGuestTarget } from './guest-bookings';
import { canManageGuest } from './guest-consent';
import { acceptPendingMove } from './booking-actions';
import { packServiceEligible, planBlock } from './pack-credits';
import { cancellationEffect, priorityOnly } from './booking-policy';
import { humanOwner, id, insist, integer, list, now, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { acknowledged, eligiblePack, planRefused, seat } from './bookings';
import { chooseSpot, seatCapacity } from './spots';
import { bookingHistory } from './booking-history';
import { putNotice, reserveMail, titleOf, whenText } from './notices';

// MSG-004 waitlist offers and expiry. The studio policy says what a vacancy
// does: 'auto' books the next eligible waiter at once; 'offer' holds the seat
// for them with a claim offer that ends after claimMinutes (never later than
// class start). Inside a waiter's late-cancel window (from the cutoff instant
// their own booking terms carry) lateWindow decides instead: 'promote' follows
// the policy, 'offer' always sends a claim offer, 'none' promotes no one and
// leaves the seat open to direct booking. Eligible means active, holding the
// current waiver and an eligible credit, in stable FIFO join order; others are
// skipped and keep their place. A credit is reserved only when a seat is
// assigned. An offer not claimed by its deadline expires, the waiter leaves
// the waitlist with no credit or fee, and the seat goes to the next eligible
// waiter. The once-a-minute sweep (sweep()) and every booking change on the
// class apply expiries.
export interface WaitlistPolicy { mode: 'auto' | 'offer'; claimMinutes: number; lateWindow: 'promote' | 'offer' | 'none'; revision: number }
const builtIn: WaitlistPolicy = {mode:'auto',claimMinutes:30,lateWindow:'promote',revision:0};
export const waitlistPolicy = (state: State): WaitlistPolicy => (state.records.get('waitlist-policy')?.data as unknown as WaitlistPolicy | undefined) ?? builtIn;

export function saveWaitlistPolicy(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(['auto','offer'].includes(input.mode as string),'invalid_waitlist_mode');
  insist(['promote','offer','none'].includes(input.lateWindow as string),'invalid_late_window');
  const policy = {id:'waitlist-policy',mode:input.mode,claimMinutes:integer(input.claimMinutes,'claim_minutes',1,1440),lateWindow:input.lateWindow,
    revision:waitlistPolicy(tx.state).revision+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('waitlistPolicy',policy); return policy;
}

const fifo = (a: RecordData, b: RecordData) => a.sequence-b.sequence || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const lateCutoff = (booking: RecordData, entry: RecordData) => new Date(Date.parse(entry.start)-(booking.cancelTerms?.cutoffHours ?? 0)*3_600_000).toISOString();

function expire(tx: Transaction, entry: RecordData) {
  const at = now();
  for (const booking of list(tx.state,'booking').filter(b => b.classId === entry.id && b.status === 'offered' && b.offer.expiresAt <= at)) {
    tx.reached(booking.offer.expiresAt);
    tx.put('booking',{...booking,status:'cancelled',cancelledAt:at,cancelledBy:'system',cancelledByRole:'system',cancellation:'offer_expired',refunded:false,feeCents:0,offer:{...booking.offer,expiredAt:at}});
    putNotice(tx,{id:`notice:expired:${booking.id}`,personId:booking.personId,bookingId:booking.id,classId:entry.id,
      subject:`Offer expired: ${titleOf(entry)}, ${whenText(tx.state,entry.start,entry.timeZone)}`,body:'The spot was not claimed in time, so it went to the next person waiting. You are off the waitlist; no credit was used.'});
  }
}

/** Fills each open online seat from the waitlist under the studio policy. */
export function promote(tx: Transaction, entry: RecordData) {
  expire(tx,entry);
  if (entry.start <= now() || entry.status !== 'published') return;
  const all = list(tx.state,'booking').filter(b => b.classId === entry.id), policy = waitlistPolicy(tx.state);
  let vacancies = seatCapacity(tx.state,entry,all).onlineOpen;
  for (const candidate of all.filter(b => b.status === 'waitlisted').sort(fifo)) {
    if (vacancies <= 0) break;
    if (!tx.state.people.some(p => p.id === candidate.personId && p.active && !p.erasedAt) || !acknowledged(tx.state,candidate.personId,entry)) continue;
    if(intakeMissing(tx.state,candidate.personId,[String(entry.service ?? entry.title).split(' · ')[0]]).length) continue;
    const source = candidate.moveFromBookingId ? tx.state.records.get(candidate.moveFromBookingId)?.data : null;
    const sourceEntry = source ? tx.state.records.get(source.classId)?.data : null;
    const sourcePack = source?.packId ? tx.state.records.get(source.packId)?.data : null;
    if (candidate.moveFromBookingId && (!source || source.status !== 'booked' || sourceEntry?.start <= now())) continue;
    const pack = candidate.moveFromBookingId ? sourcePack : eligiblePack(tx.state,candidate.personId,entry);
    let guestEligible = false;
    if (source?.makeupCreditId) { try { assertMakeupTarget(tx,source,entry); guestEligible = true; } catch (error) { if (!(error as {status?:number}).status) throw error; } }
    if (source?.guestPackId) { try { assertGuestTarget(tx,source,entry); guestEligible = true; } catch (error) { if (!(error as {status?:number}).status) throw error; } }
    if (candidate.moveFromBookingId ? !(guestEligible || source?.unpaid || (pack && pack.expiresAt > entry.start && pack.expiresAt > now() && packServiceEligible(pack,entry) && (!priorityOnly(tx.state,entry,pack) || pack.priorityBooking === true) && !planBlock(tx.state,pack,entry,source!.id))) : !pack) continue;
    const cutoff = lateCutoff(candidate,entry), late = now() >= cutoff;
    if (policy.lateWindow !== 'promote') { if (late) tx.reached(cutoff); else tx.future(cutoff); }
    if (late && policy.lateWindow === 'none') continue;
    const title = titleOf(entry), when = whenText(tx.state,entry.start,entry.timeZone);
    if (candidate.moveFromBookingId || (late && policy.lateWindow === 'offer') || policy.mode === 'offer') {
      const expiresAt = new Date(Math.min(Date.parse(now())+policy.claimMinutes*60_000,Date.parse(entry.start))).toISOString();
      const offer = {id:id(),sentAt:now(),expiresAt,claimMinutes:policy.claimMinutes,...(source ? {sourceTerms:cancellationEffect(source,sourceEntry!).key} : {}),reason:late && policy.lateWindow === 'offer' ? 'late_window' : 'policy',policyRevision:policy.revision};
      tx.put('booking',{...candidate,status:'offered',offer});
      const body = `A spot opened in ${title} on ${when}. Claim it in Strap by ${whenText(tx.state,expiresAt,entry.timeZone)}; after that it goes to the next person waiting. ${candidate.moveFromBookingId ? source?.packId ? 'Your original seat and credit stay reserved until you confirm the move. Claiming carries that credit; it does not use another.' : 'Your original unpaid visit stays booked until you confirm the move; no credit is used.' : 'A credit is used only when you claim it.'}`;
      putNotice(tx,{id:`notice:offer:${candidate.id}`,personId:candidate.personId,bookingId:candidate.id,classId:entry.id,subject:`Spot offered: ${title}, ${when}`,body});
      reserveMail(tx,tx.notices,{id:`mail:offer:${candidate.id}`,category:'waitlist_offer',sourceKind:'booking',sourceId:candidate.id,personId:candidate.personId,bookingIds:[candidate.id],subject:`Spot offered: ${title}, ${when}`,body});
    } else {
      seat(tx,candidate,entry,pack!);
      const body = `A spot opened in ${title} on ${when} and you moved up from the waitlist. You are booked; one credit from your pack is reserved.`;
      putNotice(tx,{id:`notice:promoted:${candidate.id}`,personId:candidate.personId,bookingId:candidate.id,classId:entry.id,subject:`You're booked: ${title}, ${when}`,body});
      reserveMail(tx,tx.notices,{id:`mail:promoted:${candidate.id}`,sourceKind:'booking',sourceId:candidate.id,personId:candidate.personId,bookingIds:[candidate.id],subject:`You're booked: ${title}, ${when}`,body});
    }
    vacancies--;
  }
}
export function promoteAll(tx: Transaction) {
  for (const entry of list(tx.state,'class').sort((a,b) => a.start.localeCompare(b.start))) promote(tx,entry);
}

/** The waiter claims their offered seat, or the owner (front desk until
 * STAFF-001) accepts it on their behalf. The credit is reserved now. */
export function acceptOffer(tx: Transaction, input: Record<string,unknown>) {
  const booking = record(tx.state,input.id,'booking');
  if (booking.makeupCreditId) authorizeMakeup(tx,booking.personId);
  const staff = tx.who.role === 'owner' && tx.who.isOwner;
  insist(staff || ((tx.who.role === 'member' || tx.who.role === 'instructor') && (tx.who.personId === booking.personId || (booking.makeupCreditId && canManageMakeup(tx.state,tx.who,booking.personId)) || (booking.moveFromBookingId && tx.state.records.get(booking.moveFromBookingId)?.data.guestPackId && canManageGuest(tx.state,tx.who,tx.state.records.get(booking.moveFromBookingId)!.data)))),'forbidden',403);
  const entry = record(tx.state,booking.classId,'class');
  expire(tx,entry);
  const current = record(tx.state,booking.id,'booking');
  insist(current.status === 'offered','no_open_offer',409);
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409);
  tx.future(current.offer.expiresAt); tx.future(entry.start);
  insist(acknowledged(tx.state,current.personId,entry),'waiver_acknowledgement_required',409);
  if (current.moveFromBookingId) return acceptPendingMove(tx,current,input);
  const pack = eligiblePack(tx.state,current.personId,entry);
  insist(pack,planRefused(tx.state,current.personId,entry)?.code ?? 'eligible_credit_required',409);
  const accepted = {...current,offer:{...current.offer,acceptedAt:now(),acceptedBy:tx.who.id,acceptedByRole:tx.who.role,...(staff ? {staffMade:true,right:'booking'} : {})}};
  const seated = seat(tx,accepted,entry,pack,chooseSpot(tx.state,entry,input.spot));
  bookingHistory(tx,'accept',current,seated,input);
  return seated;
}

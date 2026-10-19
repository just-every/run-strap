import { humanOwner, id, insist, list, now, preparer, record, text, type State } from './types';
import type { Transaction } from './store';
import { cancel } from './bookings';
import { moveBooking } from './booking-actions';
import { approveDraft } from './drafts';

// Preparing never reserves a seat, changes credits, assesses fees or sends a
// notice. All relevant records and identities must still match at approval.
const basis = (state: State) => JSON.stringify({people:state.people,records:['class','booking','pack','waiver','acknowledgement','bookingRule','spotLayout','waitlistPolicy','cancellationReasons'].flatMap(kind => list(state,kind).sort((a,b) => a.id.localeCompare(b.id)))});
export function prepareBookingChange(tx: Transaction, input: Record<string,unknown>) {
  preparer(tx.who);
  const action = text(input.action,'booking_action',20);
  insist(action === 'cancel' || action === 'move','invalid_booking_action');
  const booking = record(tx.state,input.id,'booking');
  insist(booking.status !== 'cancelled','already_cancelled',409);
  const change = {id:booking.id,classId:input.classId,mode:input.mode,terms:input.terms,reason:input.reason,cancelReason:input.cancelReason,channel:input.channel,override:input.override,suppressNotice:input.suppressNotice,suppressionReason:input.suppressionReason,spot:input.spot};
  const draft = {id:id(),type:'booking-change',action,status:'draft',change,basis:basis(tx.state),personId:booking.personId,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export function approveBookingChange(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.type === 'booking-change','wrong_draft_type');
  insist(draft.basis === basis(tx.state),'booking_facts_changed',409);
  approveDraft(tx,draft);
  return draft.action === 'cancel' ? cancel(tx,draft.change) : moveBooking(tx,draft.change);
}

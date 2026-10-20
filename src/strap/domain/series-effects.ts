import { studioSettings } from './studio';
import { id, insist, list, now, record, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { layoutFor, seatCapacity } from './spots';
import { packServiceEligible } from './pack-credits';
import { messageBody, putNotice, reserveMail, titleOf, whenText, type NoticeContext } from './notices';
import { resourceLabel } from './scheduling';

const spotKey = (v: string) => resourceLabel(v).toLowerCase();
const description = (state: State, c: RecordData) => `${titleOf(c)} on ${whenText(state,c.start)}, ${c.instructorName}, ${c.location ?? studioSettings(state)?.location ?? 'Studio'}${c.room ? `, ${c.room}` : ''}`;
/** Existing seats survive timetable changes, including their own pools, credits,
 * cancellation terms and spot identities; a new room gets explicit spot moves. */
export function changeImpact(state: State, before: RecordData[], after: RecordData[]) {
  const classes = after.map((entry,i) => {
    const original = before[i], bookings = list(state,'booking').filter(b => b.classId === entry.id && ['booked','waitlisted','offered'].includes(b.status)).sort((a,b) => a.id.localeCompare(b.id));
    for (const b of bookings.filter(b => b.status === 'offered')) insist(b.offer.expiresAt <= entry.start,'series_offer_deadline_after_start',409);
    const capacity = seatCapacity(state,entry);
    insist(capacity.booked <= capacity.total && capacity.onlineBooked <= capacity.online && capacity.heldBooked <= capacity.held,'series_capacity_has_existing_bookings',409);
    const layout = layoutFor(state,entry), free = layout?.spots.filter((s: RecordData) => !s.disabled).map((s: RecordData) => s.label) as string[] | undefined;
    const assignments = new Map<string,string | null>();
    // Preserve all existing matching spots before assigning remaining members.
    for (const b of bookings.filter(b => b.status === 'booked')) {
      const match = free?.find(s => b.spot && spotKey(s) === spotKey(b.spot));
      if (match) { assignments.set(b.id,match); free!.splice(free!.indexOf(match),1); }
    }
    for (const b of bookings.filter(b => b.status === 'booked')) {
      if (!assignments.has(b.id)) { const spot = free ? free.shift() : null; insist(!free || spot,'no_free_spot',409); assignments.set(b.id,spot ?? null); }
      if (b.packId) { const pack = record(state,b.packId,'pack'); insist(pack.expiresAt > entry.start && packServiceEligible(pack,entry),'series_booking_credit_ineligible',409); }
    }
    const seats = bookings.map(b => {
      const spot = assignments.get(b.id) ?? null, subject = `Class changed: ${titleOf(entry)}`;
      const body = `${description(state,original)} has changed to ${description(state,entry)}. ${b.status === 'booked' ? `${b.packId ? 'Your booking and original credit stay reserved.' : 'Your unpaid visit stays reserved; no credit was used.'}${spot ? ` Your spot is ${spot}.` : ''}` : b.status === 'offered' ? 'Your seat offer remains available until its original expiry.' : 'Your waitlist position stays the same; no credit was used.'}`;
      return {bookingId:b.id,personId:b.personId,status:b.status,previousSpot:b.spot ?? null,spot,subject,body:messageBody(state,body,[b.id],[entry])};
    });
    return {classId:entry.id,before:original,after:entry,bookings:seats};
  });
  const seats = classes.flatMap(c => c.bookings);
  return {classes,bookings:seats.length,members:new Set(seats.map(b => b.personId)).size,notices:seats.length,emails:seats.length,creditsChanged:0,moneyMoved:0};
}
export function applyChangeNotices(tx: Transaction, draft: RecordData, context: NoticeContext) {
  for (const c of draft.impact.classes) for (const seat of c.bookings) {
    const booking = record(tx.state,seat.bookingId,'booking'), actionId = id(), at = now();
    const moved = {...booking,spot:seat.spot,seriesChangeId:draft.id,...(seat.spot !== seat.previousSpot && booking.status === 'booked' ? {
      spotHistory:[...(booking.spotHistory ?? []),{from:seat.previousSpot,to:seat.spot,by:tx.who.id,byRole:tx.who.role,staffMade:true,right:'booking',channel:'desk',at}],
    } : {})};
    tx.put('booking',moved);
    putNotice(tx,{id:`notice:action:${actionId}`,personId:booking.personId,bookingId:booking.id,classId:c.classId,seriesChangeId:draft.id,subject:seat.subject,body:seat.body},true);
    const delivery = reserveMail(tx,context,{id:`mail:action:${actionId}`,sourceKind:'booking_action',sourceId:actionId,personId:booking.personId,bookingIds:[booking.id],subject:seat.subject,body:seat.body,prepared:true});
    tx.put('bookingAction',{id:actionId,action:'schedule',bookingId:booking.id,personId:booking.personId,classId:c.classId,targetClassId:c.classId,seriesChangeId:draft.id,
      before:booking,after:moved,beforeClass:c.before,afterClass:c.after,actorId:tx.who.id,actorRole:tx.who.role,staffMade:true,right:'booking',channel:'desk',reason:draft.reason,at,
      feeCents:0,creditReturned:false,notice:{status:'in_app',mailStatus:delivery.status}});
  }
}

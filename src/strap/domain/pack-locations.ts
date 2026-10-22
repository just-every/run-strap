import { humanOwner, id, insist, list, now, record, text } from './types';
import type { Transaction } from './store';
import { locationOf, packPlaces } from './locations';

/** STUDIO-002: change where a plan is valid. The same pack keeps its credits, term and ledger: nothing is granted or copied,
 * so a transfer between locations can never duplicate credits. A seat already held at a location being removed blocks the change. */
export function setPackLocations(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const pack = record(tx.state,input.id,'pack'), reason = text(input.reason,'reason',300);
  insist(input.eligibleLocations !== undefined,'invalid_eligibleLocations');
  const {eligibleLocations} = packPlaces(tx.state,{eligibleLocations:input.eligibleLocations});
  const before = pack.eligibleLocations ?? ['studio'];
  for (const booking of list(tx.state,'booking').filter(b => b.packId === pack.id && b.status === 'booked')) {
    const entry = record(tx.state,booking.classId,'class');
    insist(entry.start <= now() || eligibleLocations === 'all' || eligibleLocations.includes(locationOf(entry)),'future_bookings_at_removed_location',409);
  }
  const change = {id:id(),packId:pack.id,personId:pack.personId,before,after:eligibleLocations,reason,creditsBefore:pack.remaining,creditsAfter:pack.remaining,at:now(),by:tx.who.id};
  tx.put('packLocationChange',change);
  tx.put('pack',{...pack,eligibleLocations});
  return change;
}

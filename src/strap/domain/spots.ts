import { humanOwner, insist, list, now, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { classCapacity } from './capacity';
import { resourceLabel, roomOf } from './scheduling';

// SCHED-007: a room's named spots (reformers, bikes, mat places) in display
// order. A class in a room with spots seats each booking on one enabled spot;
// its seats are the fewer of its capacity and the room's enabled spots. Every
// write shares the domain revision fence, so two requests cannot claim one spot.
const layoutId = (room: string) => `spot-layout:${resourceLabel(room).toLowerCase()}`;
const spotKey = (label: string) => resourceLabel(label).toLowerCase();

export const spotLayouts = (state: State) => list(state,'spotLayout').filter(l => l.spots.length);
export function layoutFor(state: State, entry: RecordData) {
  const room = roomOf(entry);
  const layout = room ? state.records.get(layoutId(room)) : undefined;
  return layout?.kind === 'spotLayout' && layout.data.spots.length ? layout.data : null;
}
/** classCapacity with the room's enabled spots as the seat limit. */
export function seatCapacity(state: State, entry: RecordData, bookings: RecordData[] = list(state,'booking')) {
  const layout = layoutFor(state,entry);
  if (!layout) return classCapacity(entry,bookings);
  const seats = Math.min(entry.capacity,layout.spots.filter((s: RecordData) => !s.disabled).length);
  return classCapacity({...entry,capacity:seats,onlineCapacity:Math.min(seats,entry.onlineCapacity ?? entry.capacity)},bookings);
}
/** Each spot of a class's room: free, taken by a booked seat, or disabled. */
export function classSpots(state: State, entry: RecordData): {label: string; state: string}[] | null {
  const layout = layoutFor(state,entry);
  if (!layout) return null;
  const taken = new Set(list(state,'booking').filter(b => b.classId === entry.id && b.status === 'booked' && b.spot).map(b => spotKey(b.spot)));
  return layout.spots.map((s: RecordData) => ({label:s.label,state:s.disabled ? 'disabled' : taken.has(spotKey(s.label)) ? 'taken' : 'free'}));
}
/** The requested spot, or the first free one in room order when none is named. */
export function chooseSpot(state: State, entry: RecordData, requested: unknown) {
  const spots = classSpots(state,entry);
  if (!spots) { insist(requested === undefined || requested === '','class_has_no_spots'); return null; }
  if (requested === undefined || requested === '') {
    const free = spots.find(s => s.state === 'free');
    insist(free,'no_free_spot',409); return free.label;
  }
  const spot = spots.find(s => spotKey(s.label) === spotKey(text(requested,'spot',80)));
  insist(spot,'spot_not_found',404);
  insist(spot.state !== 'disabled','spot_disabled',409);
  insist(spot.state === 'free','spot_taken',409);
  return spot.label;
}

/** The owner names a room's spots and marks broken ones disabled. A spot held
 * by an upcoming booked seat cannot be removed or disabled until it is moved. */
export function saveSpotLayout(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const room = resourceLabel(text(input.room,'room',160));
  insist(Array.isArray(input.spots) && input.spots.length <= 200,'invalid_spots');
  const disabled = new Set((Array.isArray(input.disabled) ? input.disabled : []).map(value => spotKey(text(value,'disabled',80))));
  const spots = (input.spots as unknown[]).map(value => ({label:resourceLabel(text(value,'spot',80)),disabled:false}));
  insist(new Set(spots.map(s => spotKey(s.label))).size === spots.length,'duplicate_spot');
  for (const key of disabled) insist(spots.some(s => spotKey(s.label) === key),'disabled_spot_not_in_room');
  for (const s of spots) s.disabled = disabled.has(spotKey(s.label));
  const usable = new Set(spots.filter(s => !s.disabled).map(s => spotKey(s.label)));
  const at = now();
  for (const b of list(tx.state,'booking').filter(b => b.status === 'booked' && b.spot)) {
    const entry = record(tx.state,b.classId,'class');
    if (entry.end <= at || layoutId(roomOf(entry)) !== layoutId(room)) continue;
    insist(usable.has(spotKey(b.spot)),'spot_in_use_move_first',409);
    tx.future(entry.end);
  }
  const previous = tx.state.records.get(layoutId(room))?.data;
  const layout = {id:layoutId(room),room,spots,revision:(previous?.revision ?? 0)+1,updatedAt:at,updatedBy:tx.who.id};
  tx.put('spotLayout',layout); return layout;
}

const deskChannel = (value: unknown) => { const channel = text(value ?? 'desk','channel',30); insist(['desk','phone','inbox'].includes(channel),'invalid_channel'); return channel; };
/** A member moves their own booked seat; the owner (front desk with the booking
 * right until STAFF-001) moves any member's. Each move is kept on the booking,
 * marked staff-made when staff made it. */
export function moveSpot(tx: Transaction, input: Record<string,unknown>) {
  const booking = record(tx.state,input.id,'booking'), entry = record(tx.state,booking.classId,'class');
  const staff = tx.who.role === 'owner';
  insist(staff || (tx.who.role !== 'agent' && tx.who.personId === booking.personId),'forbidden',403);
  insist(booking.status === 'booked','confirmed_booking_required',409);
  insist(entry.start > now(),'class_already_started',409);
  tx.future(entry.start);
  insist(input.spot !== undefined && input.spot !== '','invalid_spot');
  const spot = chooseSpot(tx.state,entry,input.spot)!;
  const move = {from:booking.spot ?? null,to:spot,by:tx.who.id,byRole:tx.who.role,staffMade:staff,...(staff ? {right:'booking',channel:deskChannel(input.channel)} : {}),at:now()};
  const moved = {...booking,spot,spotHistory:[...(booking.spotHistory ?? []),move]};
  tx.put('booking',moved); return moved;
}

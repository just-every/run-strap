import type { RecordData } from './types';

/** Older classes and reservations used only the online pool. */
export function classCapacity(entry: RecordData, bookings: RecordData[]) {
  const booked = bookings.filter(b => b.classId === entry.id && b.status === 'booked');
  const online = entry.onlineCapacity ?? entry.capacity;
  const onlineBooked = booked.filter(b => b.capacityPool !== 'held').length;
  const heldBooked = booked.length - onlineBooked;
  const totalOpen = Math.max(0, entry.capacity - booked.length);
  return { total: entry.capacity, online, held: entry.capacity - online, booked: booked.length,
    onlineBooked, heldBooked, onlineOpen: Math.max(0, Math.min(totalOpen, online - onlineBooked)),
    heldOpen: Math.max(0, Math.min(totalOpen, entry.capacity - online - heldBooked)), totalOpen };
}

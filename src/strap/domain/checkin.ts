import { phoneDigits } from './phone';
import { humanOwner, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import { countsCredits } from './entitlements';
import type { Transaction } from './store';
import { balance } from './money';
import { latestWaiver } from './bookings';
import { recordCheckin } from './attendance';
import { studioSettings } from './studio';
import { classZone } from './locations';
import { localDate } from '../zone';

// ATT-001 doors beyond the staff roster: a member's own account, the paired
// kiosk's name/phone lookup, and a scanned member code (kiosk or desk). These
// doors open 60 minutes before a class's UTC start instant and close 30 minutes
// after it, [start - 60 min, start + 30 min), and only on the class's own
// studio-zone date. Staff roster check-in keeps no window.
const opensMinutes = 60, closesMinutes = 30;
const shift = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();
export function inWindow(state: State, entry: RecordData, at = now()) {
  const zone = classZone(state,entry);
  return at >= shift(entry.start,-opensMinutes) && at < shift(entry.start,closesMinutes) && localDate(at,zone) === localDate(entry.start,zone);
}
function fenceWindow(tx: Transaction, entry: RecordData) {
  insist(inWindow(tx.state,entry),'checkin_window_closed',409);
  tx.reached(shift(entry.start,-opensMinutes)); tx.future(shift(entry.start,closesMinutes));
}

// One record per member holds the phone the kiosk matches and the opaque
// 128-bit check-in code their app and key tag carry (never the person id).
const checkinId = (personId: string) => `member-checkin:${personId}`;
export const memberCheckin = (state: State, personId: string) => state.records.get(checkinId(personId))?.data ?? null;
const newCode = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
const normalCode = (value: unknown) => text(value,'code',64).replace(/[\s-]/g,'').toUpperCase();

export { phoneDigits };
export function savePhone(tx: Transaction, personId: string, value: unknown) {
  const phone = phoneDigits(value), current = memberCheckin(tx.state,personId);
  if (!current && phone === null) return;
  tx.put('memberCheckin',{id:checkinId(personId),personId,code:null,codeRevision:0,...current,phone,updatedAt:now()});
}
function issueCode(tx: Transaction, personId: string) {
  const current = memberCheckin(tx.state,personId);
  const next = {id:checkinId(personId),personId,phone:null,...current,code:newCode(),codeRevision:(current?.codeRevision ?? 0)+1,codeIssuedAt:now(),codeIssuedBy:tx.who.id};
  tx.put('memberCheckin',next); return next;
}
/** The member's own code, issued on first request; reading it again changes nothing. */
export function ownCode(tx: Transaction) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const current = memberCheckin(tx.state,tx.who.personId);
  return current?.code ? current : issueCode(tx,person(tx.state,tx.who.personId).id);
}
/** The owner issues a new code (for a lost key tag); the old one stops at once. */
export function rotateCode(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  text(input.reason,'rotation_reason',500);
  const member = person(tx.state,input.personId);
  insist(member.role === 'member','member_required');
  return issueCode(tx,member.id);
}

const bookedIn = (state: State, personId: string) => list(state,'booking')
  .filter(b => b.personId === personId && b.status === 'booked')
  .map(b => ({b,c:record(state,b.classId,'class')})).filter(({c}) => inWindow(state,c))
  .sort((x,y) => x.c.start.localeCompare(y.c.start) || x.b.id.localeCompare(y.b.id));

/** A member checks into their own booked seat from their account. */
export function selfCheckin(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const booking = record(tx.state,input.id,'booking');
  insist(booking.personId === tx.who.personId,'forbidden',403);
  const entry = record(tx.state,booking.classId,'class');
  fenceWindow(tx,entry);
  return recordCheckin(tx,booking,entry,{channel:'self'});
}

/** A scanned code checks its member into the earliest booked class in the window
 * not yet checked in. At the desk an instructor reaches only classes they teach;
 * a kiosk reaches every class. */
export function scanCheckin(tx: Transaction, input: Record<string,unknown>) {
  const who = tx.who;
  insist(who.role === 'owner' || who.role === 'instructor' || who.role === 'kiosk','forbidden',403);
  const code = normalCode(input.code);
  const owner = list(tx.state,'memberCheckin').find(r => r.code && r.code === code);
  insist(owner,'no_booking_found',404);
  const member = tx.state.people.find(p => p.id === owner.personId && p.active && !p.erasedAt && p.role === 'member');
  insist(member,'no_booking_found',404);
  const seats = bookedIn(tx.state,member.id).filter(({c}) => who.role !== 'instructor' || c.instructorId === who.personId);
  const open = seats.find(({b}) => !b.checkedInAt && !b.attendance);
  insist(seats.length,'no_booking_found',404);
  insist(open,'already_checked_in',409);
  fenceWindow(tx,open.c);
  return recordCheckin(tx,open.b,open.c,{channel:who.role === 'kiosk' ? 'kiosk_scan' : 'desk_scan',...(who.kioskId ? {kioskId:who.kioskId} : {})});
}

/** A kiosk checks in a seat it found by lookup, still inside the window. */
export function kioskCheckin(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'kiosk','kiosk_required',403);
  const booking = record(tx.state,input.id,'booking'), entry = record(tx.state,booking.classId,'class');
  insist(booking.status === 'booked' && tx.state.people.some(p => p.id === booking.personId && p.active && !p.erasedAt && p.role === 'member'),'no_booking_found',404);
  fenceWindow(tx,entry);
  return recordCheckin(tx,booking,entry,{channel:'kiosk',kioskId:tx.who.kioskId});
}

/** Kiosk lookup: only active members with a booked seat in a class whose window
 * is open, by name (2+ characters, case-insensitive, matching the start of the
 * name or of any word in it) or by a full 10-digit US phone. Each row carries a
 * first name, last initial and the class, nothing else; at most 8 rows. */
export function kioskLookup(state: State, query: unknown) {
  const q = String(query ?? '').trim().toLowerCase().replace(/\s+/g,' ');
  const digits = q.replace(/[\s().+-]/g,'');
  const phone = /^1?\d{10}$/.test(digits) ? digits.slice(-10) : null;
  if (!phone && (q.length < 2 || /^\d/.test(q))) return [];
  const matches = (p: State['people'][number]) => phone ? memberCheckin(state,p.id)?.phone === phone
    : p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(' ').some(word => word.startsWith(q));
  return state.people.filter(p => p.active && !p.erasedAt && p.role === 'member' && matches(p))
    .flatMap(p => bookedIn(state,p.id).map(({b,c}) => {
      const [first,...rest] = p.name.trim().split(/\s+/);
      return {bookingId:b.id,name:rest.length ? `${first} ${rest.at(-1)![0].toUpperCase()}.` : first,classTitle:String(c.title).split(' · ')[0],start:c.start,checkedIn:!!b.checkedInAt || !!b.attendance};
    }))
    .sort((x,y) => x.start.localeCompare(y.start) || x.name.localeCompare(y.name)).slice(0,8);
}

/** Staff check-in alerts, scoped by role. The owner (front desk and manager
 * until STAFF-001) sees money and membership alerts; an assigned instructor sees
 * the waiver and pack alerts, never money. Members and kiosks see none. Failed
 * autopay arrives with BILL-002/BILL-007, flagged staff notes with MEM-001. */
export function checkinAlerts(state: State, booking: RecordData, who: Actor) {
  if (who.role !== 'owner' && who.role !== 'instructor') return [];
  const alerts: Record<string,unknown>[] = [];
  const owed = balance(state,booking.personId);
  if (who.role === 'owner' && owed > 0) alerts.push({type:'balance_due',amountCents:owed});
  const waiver = latestWaiver(state);
  if (waiver && !list(state,'acknowledgement').some(a => a.personId === booking.personId && a.waiverId === waiver.id))
    alerts.push({type:list(state,'acknowledgement').some(a => a.personId === booking.personId) ? 'waiver_outdated' : 'waiver_missing',version:waiver.version});
  const pack = booking.packId ? state.records.get(booking.packId)?.data : null, at = now();
  if (pack) {
    // A visits or unlimited plan (PLAN-002) is never a member's last credit.
    const left = list(state,'pack').filter(p => p.personId === booking.personId && p.expiresAt > at).reduce((n,p) => n+(countsCredits(p) ? p.remaining : 1),0);
    if (left === 0) alerts.push({type:'last_credit'});
    if (Date.parse(pack.expiresAt) - Date.parse(at) < 7 * 86_400_000) alerts.push({type:'pack_expiring',expiresAt:pack.expiresAt});
  }
  return alerts;
}

/** STAFF-006: printing reads the current tag; first issuance never rotates it. */
export function staffCode(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const member = person(tx.state,input.personId); insist(member.role === 'member','member_required');
  const current = memberCheckin(tx.state,member.id); return current?.code ? current : issueCode(tx,member.id);
}

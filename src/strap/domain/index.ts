import { load, loadKiosk, Transaction } from './store';
import { DomainError, insist, list, type Actor } from './types';
import { prepareClasses, publishClasses } from './classes';
import { acknowledgeWaiver, book, deskBook, cancel, latestWaiver, publishWaiver } from './bookings';
import { checkin, correctAttendance, markNoShow } from './attendance';
import { checkinAlerts, inWindow, kioskCheckin, kioskLookup, memberCheckin, ownCode, rotateCode, scanCheckin, selfCheckin } from './checkin';
import { adjustPack, approvePack, approveReminder, balance, preparePack, prepareReminder, recordPayment } from './money';
import { erasePerson, savePerson } from './people';
import { saveStudio, studioSettings } from './studio';
import { packSummary } from './pack-credits';
import { classSpots, moveSpot, saveSpotLayout, seatCapacity, spotLayouts } from './spots';
import { saveUnavailability, removeUnavailability } from './scheduling';
import { bookingRules, bookingWindow, cancellationEffect, removeBookingRule, saveBookingRule } from './booking-policy';
export { actor } from './store';
export { DomainError } from './types';
export type { Actor, Person } from './types';

export async function command(db: D1Database, who: Actor, name: string, input: Record<string,unknown>) {
  insist(input && typeof input === 'object' && !Array.isArray(input),'invalid_input');
  const loaded = await load(db,who), tx = new Transaction(db,loaded.state,loaded.who);
  if (who.role === 'agent') insist(['classes.prepare','pack.prepare','reminder.prepare'].includes(name),'agents_can_only_prepare',403);
  const handlers = {
    'person.save':savePerson, 'person.erase':erasePerson,
    'classes.prepare':prepareClasses, 'classes.publish':publishClasses,
    'scheduling.unavailable.save':saveUnavailability, 'scheduling.unavailable.remove':removeUnavailability,
    'pack.prepare':preparePack, 'pack.approve':approvePack, 'pack.adjust':adjustPack,
    'payment.record':recordPayment, 'reminder.prepare':prepareReminder, 'reminder.approve':approveReminder,
    'booking.book':book, 'booking.desk':deskBook, 'booking.cancel':cancel, 'attendance.checkin':checkin,
    'attendance.noshow':markNoShow, 'attendance.correct':correctAttendance,
    'attendance.self':selfCheckin, 'attendance.scan':scanCheckin, 'checkin.code':ownCode, 'checkin.rotate':rotateCode,
    'waiver.publish':publishWaiver, 'waiver.acknowledge':acknowledgeWaiver,
    'studio.save':saveStudio, 'spots.save':saveSpotLayout, 'booking.spot':moveSpot, 'bookingRule.save':saveBookingRule, 'bookingRule.remove':removeBookingRule,
  };
  const handler = handlers[name as keyof typeof handlers];
  if (!handler) throw new DomainError('unknown_command',404);
  const result = await handler(tx,input);
  await tx.commit(); return result;
}
/** The kiosk's whole surface: look up, check in a found seat, or scan a code. */
export async function kioskRead(db: D1Database, kioskId: string, query: unknown) {
  const {state} = await loadKiosk(db,kioskId); return kioskLookup(state,query);
}
export async function kioskCommand(db: D1Database, kioskId: string, name: 'checkin' | 'scan', input: Record<string,unknown>) {
  const loaded = await loadKiosk(db,kioskId), tx = new Transaction(db,loaded.state,loaded.who);
  const result = name === 'scan' ? scanCheckin(tx,input) : kioskCheckin(tx,input);
  await tx.commit();
  const person = loaded.state.people.find(p => p.id === result.personId)!, entry = loaded.state.records.get(result.classId)!.data;
  const [first,...rest] = person.name.trim().split(/\s+/);
  return {name:rest.length ? `${first} ${rest.at(-1)![0].toUpperCase()}.` : first,classTitle:String(entry.title).split(' · ')[0],start:entry.start};
}
export async function snapshot(db: D1Database, who: Actor) {
  const loaded = await load(db,who), {state} = loaded;
  who = loaded.who;
  const owner = who.role === 'owner' || who.role === 'agent';
  const allClasses = list(state,'class');
  const classes = owner || who.role === 'member' ? allClasses : allClasses.filter(c => c.instructorId === who.personId);
  const assigned = new Set(classes.map(c => c.id));
  const classOf = new Map(allClasses.map(c => [c.id,c])), at = new Date().toISOString();
  // The cancellation effect is shown to the member and to staff, never to an instructor.
  const bookings = list(state,'booking').filter(b => owner || b.personId === who.personId || (who.role === 'instructor' && assigned.has(b.classId)))
    .map(b => b.status !== 'cancelled' && (owner || b.personId === who.personId) && classOf.get(b.classId)?.start > at ? {...b,cancelEffect:cancellationEffect(b,classOf.get(b.classId)!,at)} : b)
    .map(b => b.status !== 'booked' ? b : {...b,checkinOpen:inWindow(state,classOf.get(b.classId)!),...(who.role === 'owner' || who.role === 'instructor' ? {alerts:checkinAlerts(state,b,who)} : {})});
  const visibleIds = new Set([who.personId,...(who.role === 'instructor' ? bookings.map(b => b.personId) : [])]);
  const people = state.people.filter(p => !p.erasedAt && (owner || visibleIds.has(p.id))).map(p =>
    owner || p.id === who.personId ? {...p,phone:memberCheckin(state,p.id)?.phone ?? null} : {id:p.id,name:p.name,role:p.role,active:p.active});
  const own = (kind: string) => list(state,kind).filter(r => owner || r.personId === who.personId);
  return {actor:who,version:state.version,people,classes:classes.map(c => ({...c,occupancy:seatCapacity(state,c),spots:classSpots(state,c),bookingWindow:bookingWindow(state,c)})),bookingRules:bookingRules(state),bookings,packs:own('pack').map(pack => ({...pack,summary:packSummary(state,pack)})),packCreditEvents:own('packCreditEvent'),payments:own('payment'),charges:own('charge'),
    drafts:owner?list(state,'draft'):[],approvals:owner?list(state,'approval'):[],unavailability:who.role === 'owner'?list(state,'unavailability'):[],spotLayouts:who.role === 'owner'?spotLayouts(state):[],waiver:latestWaiver(state),studio:studioSettings(state),acknowledgements:own('acknowledgement'),
    checkinCodes:who.role === 'owner' || who.role === 'member' ? own('memberCheckin').filter(r => r.code).map(r => ({personId:r.personId,code:r.code,codeRevision:r.codeRevision,codeIssuedAt:r.codeIssuedAt})) : [],
    balances:state.people.filter(p => !p.erasedAt && (owner || p.id === who.personId)).map(p => ({personId:p.id,balanceCents:balance(state,p.id)}))};
}

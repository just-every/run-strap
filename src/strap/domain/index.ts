import { load, Transaction } from './store';
import { DomainError, insist, list, type Actor } from './types';
import { prepareClasses, publishClasses } from './classes';
import { acknowledgeWaiver, book, deskBook, cancel, latestWaiver, publishWaiver } from './bookings';
import { checkin, correctAttendance, markNoShow } from './attendance';
import { adjustPack, approvePack, approveReminder, balance, preparePack, prepareReminder, recordPayment } from './money';
import { erasePerson, savePerson } from './people';
import { saveStudio, studioSettings } from './studio';
import { packSummary } from './pack-credits';
import { classCapacity } from './capacity';
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
    'waiver.publish':publishWaiver, 'waiver.acknowledge':acknowledgeWaiver,
    'studio.save':saveStudio, 'bookingRule.save':saveBookingRule, 'bookingRule.remove':removeBookingRule,
  };
  const handler = handlers[name as keyof typeof handlers];
  if (!handler) throw new DomainError('unknown_command',404);
  const result = await handler(tx,input);
  await tx.commit(); return result;
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
    .map(b => b.status !== 'cancelled' && (owner || b.personId === who.personId) && classOf.get(b.classId)?.start > at ? {...b,cancelEffect:cancellationEffect(b,classOf.get(b.classId)!,at)} : b);
  const visibleIds = new Set([who.personId,...(who.role === 'instructor' ? bookings.map(b => b.personId) : [])]);
  const people = state.people.filter(p => !p.erasedAt && (owner || visibleIds.has(p.id))).map(p =>
    owner || p.id === who.personId ? p : {id:p.id,name:p.name,role:p.role,active:p.active});
  const own = (kind: string) => list(state,kind).filter(r => owner || r.personId === who.personId);
  return {actor:who,version:state.version,people,classes:classes.map(c => ({...c,occupancy:classCapacity(c,list(state,'booking')),bookingWindow:bookingWindow(state,c)})),bookingRules:bookingRules(state),bookings,packs:own('pack').map(pack => ({...pack,summary:packSummary(state,pack)})),packCreditEvents:own('packCreditEvent'),payments:own('payment'),charges:own('charge'),
    drafts:owner?list(state,'draft'):[],approvals:owner?list(state,'approval'):[],unavailability:who.role === 'owner'?list(state,'unavailability'):[],waiver:latestWaiver(state),studio:studioSettings(state),acknowledgements:own('acknowledgement'),
    balances:state.people.filter(p => !p.erasedAt && (owner || p.id === who.personId)).map(p => ({personId:p.id,balanceCents:balance(state,p.id)}))};
}

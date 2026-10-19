import { load, Transaction } from './store';
import { DomainError, insist, list, type Actor } from './types';
import { prepareClasses, publishClasses } from './classes';
import { acknowledgeWaiver, book, cancel, checkin, latestWaiver, publishWaiver } from './bookings';
import { adjustPack, approvePack, approveReminder, balance, preparePack, prepareReminder, recordPayment } from './money';
import { erasePerson, savePerson } from './people';
import { saveStudio, studioSettings } from './studio';
import { packSummary } from './pack-credits';
import { saveUnavailability, removeUnavailability } from './scheduling';
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
    'booking.book':book, 'booking.cancel':cancel, 'attendance.checkin':checkin,
    'waiver.publish':publishWaiver, 'waiver.acknowledge':acknowledgeWaiver,
    'studio.save':saveStudio,
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
  const bookings = list(state,'booking').filter(b => owner || b.personId === who.personId || (who.role === 'instructor' && assigned.has(b.classId)));
  const visibleIds = new Set([who.personId,...(who.role === 'instructor' ? bookings.map(b => b.personId) : [])]);
  const people = state.people.filter(p => !p.erasedAt && (owner || visibleIds.has(p.id))).map(p =>
    owner || p.id === who.personId ? p : {id:p.id,name:p.name,role:p.role,active:p.active});
  const own = (kind: string) => list(state,kind).filter(r => owner || r.personId === who.personId);
  return {actor:who,version:state.version,people,classes,bookings,packs:own('pack').map(pack => ({...pack,summary:packSummary(state,pack)})),packCreditEvents:own('packCreditEvent'),payments:own('payment'),charges:own('charge'),
    drafts:owner?list(state,'draft'):[],approvals:owner?list(state,'approval'):[],unavailability:who.role === 'owner'?list(state,'unavailability'):[],waiver:latestWaiver(state),studio:studioSettings(state),acknowledgements:own('acknowledgement'),
    balances:state.people.filter(p => !p.erasedAt && (owner || p.id === who.personId)).map(p => ({personId:p.id,balanceCents:balance(state,p.id)}))};
}

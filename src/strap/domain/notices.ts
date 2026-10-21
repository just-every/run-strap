import { humanOwner, now, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { studioSettings } from './studio';
import { messagePreference, messageTemplates } from './message-settings';

// Member notices: an in-app notice record, and at most one email per member
// per source record reserved in st_notice_deliveries in the same commit. A
// reserved email is sent only after that commit (notice-mail.ts) through the
// installation's configured Base mail provider; with none configured the row
// says so and the member has the in-app notice only.
// The first reservation records the installation (its origin) that member email
// belongs to. A native restore into another installation (MOVE-011) keeps that
// record, so its reservations are 'paused' and nothing is sent until the human
// owner reviews and reconnects member email there.
export interface NoticeContext { mailConfigured?: boolean; origin?: string; queued?: string[] }
export const memberMail = (state: State) => state.records.get('member-mail')?.data ?? null;
export const mailNotConfigured = 'email not configured; members see an in-app notice only';

const zoneOf = (state: State) => studioSettings(state)?.timeZone ?? 'UTC';
export const whenText = (state: State, at: string) => new Intl.DateTimeFormat('en-US',{timeZone:zoneOf(state),weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(at));
export const titleOf = (entry: RecordData) => String(entry.title).split(' · ')[0];

/** Same required facts in every booking/class notice; templates add prose,
 * never replace time, location, policy or the authenticated self-service door. */
export function messageBody(state: State, body: string, bookingIds: string[], entries: RecordData[] = []) {
  const studio = studioSettings(state), template = messageTemplates(state);
  const facts = bookingIds.map(id => {
    const booking = state.records.get(id)?.data;
    const entry = entries.find(c => c.id === booking?.classId) ?? state.records.get(booking?.classId)?.data;
    if (!entry) return '';
    const exact = (at: string) => new Intl.DateTimeFormat('en-US',{timeZone:studio?.timeZone ?? 'UTC',year:'numeric',timeZoneName:'shortOffset',hour:'numeric',minute:'2-digit'}).format(new Date(at));
    const terms = booking?.cancelTerms ?? {cutoffHours:0,lateReturnsCredit:true,lateFeeCents:0};
    return `${titleOf(entry)}: ${whenText(state,entry.start)} [${exact(entry.start)}] to ${whenText(state,entry.end)} [${exact(entry.end)}] (${studio?.timeZone ?? 'UTC'}). Location: ${entry.location ?? studio?.location ?? 'Studio'}${entry.room ? ', '+entry.room : ''}. Instructor: ${entry.instructorName}. Cancellation policy: ${terms.cutoffHours} hours before start; late cancellation ${terms.lateReturnsCredit ? 'returns' : 'uses'} the credit, $${(terms.lateFeeCents/100).toFixed(2)} fee. Manage your bookings after sign-in: /app`;
  }).filter(Boolean);
  return [template.prefix,body,...facts,template.suffix].filter(Boolean).join('\n\n');
}
export function putNotice(tx: Transaction, notice: RecordData, prepared = false) {
  tx.put('notice',{createdAt:now(),dismissedAt:null,...notice,body:prepared ? notice.body : messageBody(tx.state,notice.body,notice.bookingId ? [notice.bookingId] : [])});
}
export function confirmBooking(tx: Transaction, booking: RecordData) {
  const entry = tx.state.records.get(booking.classId)!.data;
  const subject = `${booking.status === 'booked' ? 'Booking confirmed' : 'Waitlist confirmed'}: ${titleOf(entry)}`;
  const body = booking.status === 'booked' ? booking.makeupCreditId ? 'Your replacement class is booked with the linked makeup credit; the original absence stays recorded.' : booking.packId ? 'Your class is booked; one credit is reserved.' : 'Your unpaid visit is booked; no credit was used.' : 'You joined the waitlist; no credit was used.';
  putNotice(tx,{id:`notice:confirmation:${booking.id}`,personId:booking.personId,bookingId:booking.id,classId:entry.id,subject,body});
  reserveMail(tx,tx.notices,{id:`mail:confirmation:${booking.id}`,sourceKind:'confirmation',sourceId:booking.id,personId:booking.personId,bookingIds:[booking.id],subject,body});
}

/** Reserves one email for a member about one source record (a closure or a booking). */
export function reserveMail(tx: Transaction, context: NoticeContext, mail: {id: string; sourceKind: 'closure' | 'booking' | 'booking_action' | 'confirmation' | 'reminder'; sourceId: string; personId: string; bookingIds: string[]; subject: string; body: string; prepared?: boolean; category?: 'waitlist_offer'}) {
  const member = tx.state.people.find(p => p.id === mail.personId);
  const connection = memberMail(tx.state);
  if (!connection && context.origin) tx.put('mailConnection',{id:'member-mail',origin:context.origin,connectedAt:now(),connectedBy:'first-use'});
  const status = mail.category !== 'waitlist_offer' && messagePreference(tx.state,mail.personId).optedOut ? 'opted_out' : connection && connection.origin !== context.origin ? 'paused' : !context.mailConfigured ? 'not_configured' : member?.email && !member.erasedAt ? 'queued' : 'no_address';
  // UNIQUE(source_kind, source_id, person_id) refuses a second reservation for the same source.
  tx.sql.push(tx.statement('INSERT INTO st_notice_deliveries(id,source_kind,source_id,person_id,booking_ids,recipient,subject,body,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    mail.id,mail.sourceKind,mail.sourceId,mail.personId,JSON.stringify(mail.bookingIds),status === 'queued' ? member!.email : null,mail.subject,(mail.prepared ? mail.body : messageBody(tx.state,mail.body,mail.bookingIds)) + (context.origin ? `\n\nOpen Strap: ${context.origin}/app` : ''),status,Date.parse(now())));
  if (status === 'queued') (context.queued ??= []).push(mail.id);
  return {id:mail.id,personId:mail.personId,status};
}

/** The owner reviews and connects member email to this installation (after a
 * restore, a reconnection). */
export function connectMemberMail(tx: Transaction, _input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const previous = memberMail(tx.state);
  const connection = {id:'member-mail',origin:context.origin,connectedAt:now(),connectedBy:tx.who.id,...(previous ? {previousOrigin:previous.origin} : {})};
  tx.put('mailConnection',connection); return connection;
}

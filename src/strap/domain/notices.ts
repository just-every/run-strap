import { humanOwner, now, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { studioSettings } from './studio';

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

export function putNotice(tx: Transaction, notice: RecordData) {
  tx.put('notice',{createdAt:now(),dismissedAt:null,...notice});
}

/** Reserves one email for a member about one source record (a closure or a booking). */
export function reserveMail(tx: Transaction, context: NoticeContext, mail: {id: string; sourceKind: 'closure' | 'booking' | 'booking_action'; sourceId: string; personId: string; bookingIds: string[]; subject: string; body: string}) {
  const member = tx.state.people.find(p => p.id === mail.personId);
  const connection = memberMail(tx.state);
  if (!connection && context.origin) tx.put('mailConnection',{id:'member-mail',origin:context.origin,connectedAt:now(),connectedBy:'first-use'});
  const status = connection && connection.origin !== context.origin ? 'paused' : !context.mailConfigured ? 'not_configured' : member?.email && !member.erasedAt ? 'queued' : 'no_address';
  // UNIQUE(source_id, person_id) refuses a second reservation for the same source.
  tx.sql.push(tx.statement('INSERT INTO st_notice_deliveries(id,source_kind,source_id,person_id,booking_ids,recipient,subject,body,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    mail.id,mail.sourceKind,mail.sourceId,mail.personId,JSON.stringify(mail.bookingIds),status === 'queued' ? member!.email : null,mail.subject,mail.body,status,Date.parse(now())));
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

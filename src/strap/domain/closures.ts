import { humanOwner, id, instant, insist, list, now, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { mailBasis, seriesBasis } from './series-model';
import { bookingCredit } from './pack-credits';
import { resourceLabel, roomOf } from './scheduling';
import { mailNotConfigured, putNotice, reserveMail, titleOf, whenText, type NoticeContext } from './notices';

// SCHED-008. The owner (manager until STAFF-001) cancels one class, or closes a
// room or the whole location for an interval, which cancels every published
// class there that has not started: classes overlapping [start, end) by their
// own start and end instants. A closure is prepared with an impact preview and
// confirmed against that exact impact; confirming returns each booked credit
// to its own pack once, closes each waitlist, and reserves one in-app notice per
// affected booking and one email per affected member covering all of their
// bookings in the closure. Confirming again changes nothing.
// A room closure also blocks that room for new classes (SCHED-003); a location
// closure blocks every new class in its interval. Card refunds belong to
// BILL-008, other locations to STUDIO-002.
const key = (value: string) => resourceLabel(value).toLowerCase();

function scopeOf(state: State, input: Record<string,unknown>) {
  const scope = text(input.scope,'scope',20);
  insist(['class','room','location'].includes(scope),'invalid_scope');
  if (scope === 'class') {
    const entry = record(state,input.classId,'class');
    insist(entry.status === 'published','class_not_open',409);
    return {scope,classId:entry.id};
  }
  const start = instant(input.start,'start'), end = instant(input.end,'end');
  insist(end > start,'closure_end_must_follow_start');
  return {scope,start,end,...(scope === 'room' ? {room:resourceLabel(text(input.room,'room',100))} : {})};
}
function affected(state: State, scope: Record<string,any>) {
  const at = now();
  return list(state,'class').filter(c => c.status === 'published' && c.start > at && (scope.scope === 'series' ? scope.classIds.includes(c.id) : scope.scope === 'class' ? c.id === scope.classId
    : c.start < scope.end && c.end > scope.start && (scope.scope === 'location' || key(roomOf(c)) === key(scope.room))))
    .sort((a,b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
/** What confirming would do now, member by member. */
export function closureImpact(state: State, scope: Record<string,any>) {
  const classes = affected(state,scope).map(c => {
    const seats = list(state,'booking').filter(b => b.classId === c.id && ['booked','offered','waitlisted'].includes(b.status))
      .sort((a,b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id));
    return {classId:c.id,title:c.title,start:c.start,end:c.end,room:roomOf(c),
      bookings:seats.map(b => ({bookingId:b.id,personId:b.personId,status:b.status,creditReturned:b.status === 'booked' && !!(b.packId || b.guestPackId || b.makeupCreditId)}))};
  });
  const bookings = classes.flatMap(c => c.bookings);
  return {classes,members:new Set(bookings.map(b => b.personId)).size,creditsReturned:bookings.filter(b => b.creditReturned).length,
    waitlistClosed:bookings.filter(b => b.status !== 'booked').length,moneyMoved:0,
    key:JSON.stringify({classes:classes.map(c => ({...c,source:state.records.get(c.classId)?.data})),messages:[...state.records.values()].filter(r => ['messagePreference','messageTemplates'].includes(r.kind)).map(r => r.data).sort((a,b) => a.id.localeCompare(b.id))})};
}

export function prepareClosure(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const scope = scopeOf(tx.state,input), reason = text(input.reason,'reason',300);
  const impact = closureImpact(tx.state,scope);
  insist(scope.scope !== 'class' || impact.classes.length === 1,'class_already_started',409);
  const closure = {id:id(),status:'draft',...scope,reason,impact,email:context.mailConfigured ? 'configured' : mailNotConfigured,createdAt:now(),createdBy:tx.who.id};
  tx.put('closure',closure); return closure;
}

/** Internal series selection: a single closure identity groups every member's
 * affected occurrences into one email, while each booking keeps its own notice. */
export async function prepareSelectedClosure(tx: Transaction, selection: {seriesId:string;classIds:string[];seriesScope:string}, reason: string, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const scope = {scope:'series',...selection}, impact = closureImpact(tx.state,scope);
  insist(impact.classes.length === selection.classIds.length,'series_impact_changed',409);
  const closure = {id:id(),status:'draft',...scope,reason,impact,basis:(await seriesBasis(tx.state)),mailBasis:mailBasis(context),email:context.mailConfigured ? 'configured' : mailNotConfigured,createdAt:now(),createdBy:tx.who.id};
  tx.put('closure',closure); return closure;
}

export async function confirmClosure(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const closure = record(tx.state,input.id,'closure');
  if (closure.status === 'applied') return {closure,deliveries:[]};
  insist(closure.status === 'draft','closure_not_draft',409);
  if (closure.scope === 'series') insist(closure.basis === (await seriesBasis(tx.state)) && closure.mailBasis === mailBasis(context),'series_impact_changed',409);
  const impact = closureImpact(tx.state,closure);
  insist(text(input.impact,'impact',9_000_000) === closure.impact.key && impact.key === closure.impact.key,'closure_impact_changed',409);
  const at = now(), deliveries: RecordData[] = [], mail = new Map<string,{subjects:string[];lines:string[];bookingIds:string[]}>();
  for (const item of impact.classes) {
    const entry = record(tx.state,item.classId,'class');
    tx.future(entry.start);
    tx.put('class',{...entry,status:'cancelled',cancelledAt:at,cancelledBy:tx.who.id,cancelReason:closure.reason,closureId:closure.id});
    for (const seat of item.bookings) {
      const booking = record(tx.state,seat.bookingId,'booking');
      if (booking.status === 'booked') bookingCredit(tx,booking,{type:'restore',credits:1,bookingId:booking.id,classId:entry.id,reason:'class_cancelled'});
      tx.put('booking',{...booking,status:'cancelled',cancelledAt:at,cancelledBy:tx.who.id,cancelledByRole:tx.who.role,cancellation:booking.status === 'booked' ? 'class_cancelled' : 'waitlist_closed',refunded:booking.status === 'booked' && !!(booking.packId || booking.guestPackId || booking.makeupCreditId),feeCents:0,closureId:closure.id});
      const title = titleOf(entry), when = whenText(tx.state,entry.start);
      const body = `${title} on ${when} is cancelled. Reason: ${closure.reason}. ${booking.status === 'booked' ? booking.makeupCreditId ? 'Your makeup credit is available again until its original expiry.' : booking.guestPackId ? 'Your guest pass was returned or the guest charge reversed.' : booking.packId ? 'Your class credit is back in your pack.' : 'Your unpaid visit is closed; no credit was used.' : 'Your waitlist spot is closed; no credit was used.'}`;
      const notice = {id:`notice:${booking.id}`,personId:booking.personId,bookingId:booking.id,classId:entry.id,closureId:closure.id,subject:`Cancelled: ${title}, ${when}`,body};
      insist(!tx.state.records.has(notice.id),'notice_exists',409);
      putNotice(tx,notice);
      const letter = mail.get(booking.personId) ?? {subjects:[],lines:[],bookingIds:[]};
      letter.subjects.push(notice.subject); letter.lines.push(body); letter.bookingIds.push(booking.id); mail.set(booking.personId,letter);
    }
  }
  // One email per member per closure, covering all of their bookings in it.
  for (const [personId,letter] of mail) deliveries.push(reserveMail(tx,context,{id:`mail:${closure.id}:${personId}`,sourceKind:'closure',sourceId:closure.id,personId,bookingIds:letter.bookingIds,
    subject:letter.subjects.length === 1 ? letter.subjects[0] : `Cancelled: ${letter.subjects.length} of your classes`,body:letter.lines.join('\n\n')}));
  if (closure.scope === 'room') tx.put('unavailability',{id:`closure-room:${closure.id}`,resourceKind:'room',resourceId:closure.room,resourceName:closure.room,start:closure.start,end:closure.end,
    reason:`Closed: ${closure.reason}`,status:'active',closureId:closure.id,createdAt:at,createdBy:tx.who.id,updatedAt:at,updatedBy:tx.who.id});
  const applied = {...closure,status:'applied',impact,appliedAt:at,appliedBy:tx.who.id};
  tx.put('closure',applied);
  return {closure:applied,deliveries};
}

/** New classes cannot be scheduled into an applied location closure. */
export function refuseLocationClosures(state: State, classes: RecordData[]) {
  for (const c of classes) {
    const closed = list(state,'closure').find(x => x.status === 'applied' && x.scope === 'location' && c.start < x.end && c.end > x.start);
    insist(!closed,`Location closed ${closed?.start} to ${closed?.end}: ${closed?.reason}`,409);
  }
}

export function dismissNotice(tx: Transaction, input: Record<string,unknown>) {
  const notice = record(tx.state,input.id,'notice');
  insist(tx.who.personId === notice.personId,'forbidden',403);
  if (notice.dismissedAt) return notice;
  const dismissed = {...notice,dismissedAt:now()}; tx.put('notice',dismissed); return dismissed;
}

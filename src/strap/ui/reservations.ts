// SCHED-005 uses Strap's existing panels, stacked tables and native forms.
import { effectText, actionChannel, cancellationReason } from './booking-rules';
import { money, when } from './format';
import { body, cell, emptyLine, field, form, h, hidden, owner, panel, rows, select, table } from './shared';
const reason = (value: string) => ({class_cancelled:'Class closed',class_already_started:'Class started',no_eligible_entitlement:'No eligible pack or plan',outside_plan_hours:'Outside plan hours',waiver_acknowledgement_required:'Current waiver not acknowledged',already_booked:'Already reserved',booking_window_closed:'Booking closed'} as Record<string,string>)[value] ?? value.replace(/_/g,' ');
function terms(o: any) {
  const t = o.cancelTerms;
  return t ? `<small>Cancel cutoff: ${t.cutoffHours} hours before start. Late cancel: ${t.lateReturnsCredit ? 'credit returns' : 'credit kept'}, ${money(t.lateFeeCents)} fee. No-show fee: ${money(t.noShowFeeCents)}.</small>` : '';
}
function outcomeTable(s: any, r: any, cancelling = false) {
  const zoned = {...s,studio:{...s.studio,timeZone:r.timeZone}};
  return `<p class="meta">Times in ${h(r.timeZone)}.</p><div class="table-wrap">${table(['Occurrence','Outcome'],r.outcomes.map((o: any) => {
    const current = o.bookingId ? rows(s,'bookings').find(b => b.id === o.bookingId) : null;
    const entry = current ? rows(s,'classes').find(c => c.id === current.classId) : null;
    const state = current?.status ?? o.status;
    return `<tr>${cell('Occurrence',when(zoned,entry?.start ?? o.start))}${cell('Outcome',cancelling ? h(effectText(o.effect,o.status !== 'booked')) : `<strong>${h(state === 'booked' ? 'Booked' : state === 'waitlisted' ? 'Waitlisted' : state === 'offered' ? 'Spot offered' : state === 'cancelled' ? 'Cancelled' : 'Skipped')}</strong>${o.reason ? `<small>${h(reason(o.reason))}</small>` : terms(o)}`)}</tr>`;
  }).join(''))}</div>`;
}
export function reservationsPanel(s: any, personId: string, back: string) {
  if (!personId || !['member','owner'].includes(s.actor.role)) return '';
  const memberFields = owner(s) ? hidden('personId',personId) + actionChannel() : '';
  const classes = rows(s,'classes').filter(c => c.seriesId && c.status === 'published' && Date.parse(c.start) > Date.now()).sort((a,b) => a.start.localeCompare(b.start));
  const choices: [unknown,unknown][] = [['','Choose a recurring class'],...classes.map(c => [c.id,`${c.title} · ${when(s, c.start, c.timeZone).replace(/<[^>]*>/g,'')}`] as [unknown,unknown])];
  const editor = classes.length ? form('reservation.prepare',back,memberFields + hidden('requestId',crypto.randomUUID()) + select('classId','First class',choices) + field('throughDate','Reserve through (inclusive)','','date','required'), 'Preview recurring reservation') : emptyLine('The studio has no published recurring classes.');
  const previews = rows(s,'reservationPreviews').filter(r => r.personId === personId && r.status === 'preview').slice(-5).reverse().map(r => {
    const cancelling = r.operation === 'cancel';
    const fields = memberFields + hidden('id',r.id) + hidden('key',r.key) + hidden('requestId',crypto.randomUUID()) + (owner(s) && cancelling ? cancellationReason(s) : '');
    return `<details class="more" open data-reservation-preview="${h(r.id)}"><summary>${cancelling ? 'Review future cancellations' : 'Review recurring reservation'}</summary><div class="panel-body">${outcomeTable(s,r,cancelling)}${form(cancelling ? 'reservation.cancel.confirm' : 'reservation.confirm',back,fields,cancelling ? 'Confirm future cancellations' : 'Confirm recurring reservation')}</div></details>`;
  }).join('');
  const saved = rows(s,'reservations').filter(r => r.personId === personId).slice().reverse().map(r => `<details class="more" open data-reservation="${h(r.id)}"><summary>Recurring reservation · ${h(r.status)}</summary><div class="panel-body">${outcomeTable(s,r)}${r.status === 'active' ? form('reservation.cancel.prepare',back,memberFields + hidden('reservationId',r.id) + hidden('requestId',crypto.randomUUID()),'Review future cancellations','quiet') : '<p class="meta">Future cancellations recorded. Past and started visits were kept.</p>'}</div></details>`).join('');
  return panel('Recurring reservations',body('<p class="meta">Reserve published occurrences through your chosen date. Review every booked, waitlisted or skipped date before confirming. Each date uses its own pack or plan, booking window and cancellation policy. Future cancellations keep past and started visits.</p>'+editor),{id:'recurring-reservations',icon:'calendar'}) + previews + saved;
}

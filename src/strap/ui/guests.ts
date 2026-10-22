import { body, cell, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, table, textarea } from './shared';
import { money, when, whenLabel } from './format';
import { packName } from './facts';
import { cancellationReason } from './booking-rules';

export function guestFields() {
  return `<details class="more"><summary>Guest-pass allowance</summary>${body(`<p>Guest passes have their own ledger. Unused passes roll into the next paid period only, up to the limit; they expire with the pack. A freeze extension keeps only the remaining final paid allowance. Guests first sign in and authorize their host.</p>`
    +field('guestPasses','Guest passes per period (blank = none)','','number','min="1" max="100"')
    +select('guestPeriod','Guest allowance period',[['month','Month'],['week','Week']],'month')
    +field('guestRollover','Unused guest passes rolling over','0','number','min="0" max="100"')
    +textarea('guestServices','Guest eligible services (one per line; blank = all)')
    +field('guestLimit','Complimentary visits per guest','1','number','min="1" max="100"')
    +field('guestWindow','Per-guest rolling window in days','365','number','min="1" max="3660"')
    +select('guestExcess','When a pass is unavailable',[['refuse','Refuse booking'],['charge','Charge the guest drop-in price']],'refuse')
    +field('guestPrice','Guest drop-in price','0.00','text','inputmode="decimal"'))}</details>`;
}
function guestTermsText(terms: any) {
  return `Cancellation cutoff: ${terms.cutoffHours} hours before class. Any cancellation returns the guest pass or reverses the guest price once. Late cancellation or a late move adds ${money(terms.lateFeeCents)} to the host’s studio balance. A no-show adds ${money(terms.noShowFeeCents)} to the host’s studio balance${terms.noShowGraceMinutes ? ` after a ${terms.noShowGraceMinutes}-minute grace period` : ''}. No payment is collected.`;
}
function guestActionFields(s: any, b: any, staff: boolean) {
  const e = b.cancelEffect;
  if (!e) return '';
  const terms = hidden('terms',e.key);
  if (!staff) return terms;
  const options: [string,string][] = [['','Choose cancellation timing']];
  if (e.timing === 'late') options.push(['late',`Late: ${money(e.feeCents)} host fee`]);
  if (e.timing === 'early' || e.waivable) options.push(['early',e.waivable ? 'Early: waive the host fee' : 'Early: no fee']);
  return terms+cancellationReason(s)+field('reason','Cancellation comment','','text','required maxlength="500"')
    +select('mode','Cancellation timing',options)+hidden('channel','desk');
}
function guestManage(s: any, b: any, bookings: any[], staff: boolean, path: string) {
  const c = rows(s,'classes').find(c=>c.id===b.classId), future = c?.start>new Date().toISOString();
  if (b.status==='booked' && future && b.cancelEffect) {
    const e = b.cancelEffect, fields = hidden('id',b.id)+guestActionFields(s,b,staff);
    return `<small>${h(e.timing)} cancellation: guest pass returned or guest price reversed; ${money(e.feeCents)} host fee.</small>`
      +form('booking.cancel',path,fields,'Cancel guest seat','quiet')
      +`<details><summary>Move guest seat</summary>${form('booking.move',path,fields+hidden('requestId',crypto.randomUUID())+select('classId','Replacement class',rows(s,'classes').filter(c=>c.status==='published' && c.start>new Date().toISOString() && c.id!==b.classId).map(c=>[c.id,`${c.title} · ${whenLabel(s,c.start)}`])),'Move guest seat','quiet')}</details>`;
  }
  if (b.status==='offered' && b.moveFromBookingId) {
    const source = bookings.find(source=>source.id===b.moveFromBookingId);
    return source ? form('booking.offer.accept',path,hidden('id',b.id)+guestActionFields(s,source,staff),'Confirm offered guest move','quiet') : '—';
  }
  return staff && b.status==='cancelled' && ['early','late'].includes(b.cancellation) && future
    ? form('booking.restore',path,hidden('id',b.id)+hidden('channel','desk')+field('reason','Restore reason','','text','required'),'Restore guest seat','quiet') : '—';
}
export function guestsPanel(s: any) {
  if (!s.guests || !['owner','member'].includes(s.actor.role)) return '';
  const g = s.guests, staff = owner(s), path = '/app/packs#guests';
  const guestName = (id: string) => rows(s,'people').find(p=>p.id===id)?.name ?? (g.guests ?? []).find((p: any)=>p.id===id)?.name ?? 'Guest';
  const packs = rows(s,'packs').filter(p => p.guestTerms), consents = g.consents ?? [], bookings = g.bookings ?? [];
  const permissions = !staff ? `<details class="more"><summary>Allow a host or payer relationship</summary>${body(`<p>Choose a host by their exact studio sign-in email. As a guest, you allow this host to book and manage your guest seats. As a payer, you allow confirmed guest charges up to your per-seat limit. You can withdraw permission here.</p>${form('guest.consent.save',path,
    field('sponsorEmail','Host’s studio email','','email','required')
    +select('kind','I am authorizing as',[['guest','Guest'],['payer','Payer']],'guest')
    +field('maxCharge','Maximum charge per guest seat (payer only)','0.00','text','inputmode="decimal"')
    +'<label class="check"><input type="checkbox" name="consent" value="true" required> I explicitly authorize this host.</label>', 'Save guest permission')}`)}</details>` : '';
  const grants = consents.length ? `<div class="table-wrap">${table(['Relationship','Person','Status','Action'],consents.map((c: any) => `<tr>${cell('Relationship',h(c.type))}${cell('Person',h(c.name))}${cell('Status',c.active ? `Allowed${c.type === 'payer' ? ` · ${money(c.maxChargeCents)} maximum` : ''}` : 'Withdrawn')}${cell('Action',c.personId === s.actor.personId && c.active ? form('guest.consent.revoke',path,hidden('id',c.id),'Withdraw permission','quiet') : '—')}</tr>`).join(''))}</div>` : emptyLine('No guest permissions yet.');
  const allowances = g.allowances.length ? g.allowances.map((a: any) => {
    const p = packs.find(p => p.id === a.packId), t = a.terms;
    return `<details class="more"><summary>${h(staff ? person(s,a.personId)+' · ' : '')}${h(p ? packName(p) : 'Guest allowance')} · ${a.left} guest passes left in the current paid allowance</summary>${body(`<p>${t.passes} per ${h(t.period)}; up to ${t.rollover} unused roll into the next period. ${h(t.services.join(', ') || 'All services')}. ${t.perGuest} complimentary visit(s) per guest in ${t.windowDays} days. Excess: ${t.excess === 'charge' ? money(t.priceCents)+' added to the consenting payer’s balance after confirmation' : 'booking refused'}. Expires ${when(s,a.expiresAt)}.</p>`)}<div class="table-wrap">${table(['Period','Passes held','Allowance','Rolls over'],a.periods.map((p: any) => `<tr>${cell('Period',h(p.start))}${cell('Passes held',String(p.used))}${cell('Allowance',String(p.allowance))}${cell('Rolls over',String(p.carriedOut))}</tr>`).join(''))}</div></details>`;
  }).join('') : emptyLine('Your plan has no guest allowance.');
  const guestOptions = staff ? rows(s,'people').filter(p => consents.some((c: any) => c.active && c.type === 'guest' && c.personId === p.id)) : g.guests;
  const prepare = packs.length && guestOptions.length ? `<details class="more"><summary>Book a guest</summary>${body(form('guest.preview',path,
    (staff ? select('sponsorId','Host',rows(s,'people').filter(p=>p.role==='member' && p.active).map(p=>[p.id,p.name])) : '')
    +select('packId','Host’s guest allowance',packs.map(p=>[p.id,(staff ? person(s,p.personId)+' · ' : '')+packName(p)]))
    +select('guestId','Consenting guest',guestOptions.map((p: any)=>[p.id,p.name]))
    +select('classId','Guest class',rows(s,'classes').filter(c=>c.status==='published' && c.start>new Date().toISOString()).map(c=>[c.id,`${c.title} · ${whenLabel(s,c.start)}`]))
    +select('payerId','Payer (for a charged seat)',[['','Host pays'],...consents.filter((c: any)=>c.type==='payer' && c.active).map((c: any)=>[c.personId,c.name] as [string,string])],'',''),'Preview guest booking'))}</details>` : '';
  const drafts = g.drafts.filter((d: any)=>d.status==='preview').slice(-5).reverse().map((d: any) => `<article class="record"><h3>Guest booking preview</h3>${body(`<p>${h(guestName(d.personId))} · ${h(rows(s,'classes').find(c=>c.id===d.classId)?.title)} · ${d.funding==='pass' ? 'One guest pass; own credits unchanged' : money(d.amountCents)+' to the consenting payer’s studio balance'}. No payment is collected.</p><p>${h(d.cancelTerms ? guestTermsText(d.cancelTerms) : 'Cancellation terms changed. Prepare a new preview before confirming.')}</p>${form('guest.book',path,hidden('id',d.id)+'<label class="check"><input type="checkbox" name="confirm" value="true" required> Confirm this guest seat and exact charge.</label>','Confirm guest booking')}`)}</article>`).join('');
  const seats = bookings.length ? `<div class="table-wrap">${table(['Guest','Guest class','Allocation','Status','Manage'],bookings.map((b: any)=>{
    const c = rows(s,'classes').find(c=>c.id===b.classId);
    return `<tr>${cell('Guest',h(guestName(b.personId)))}${cell('Guest class',h(c?.title ?? 'Class')+(c ? `<small>${when(s,c.start)}</small>` : ''))}${cell('Allocation',b.guestFunding==='pass' ? 'Guest pass' : money(b.guestPriceCents)+' · payer balance')}${cell('Status',h(b.status))}${cell('Manage',guestManage(s,b,bookings,staff,path))}</tr>`;
  }).join(''))}</div>` : emptyLine('No guest bookings.');
  const events = g.events.length ? `<details class="more"><summary>Guest-pass ledger</summary><div class="table-wrap">${table(['When','Guest','Event','Allocation'],g.events.slice().reverse().map((e: any)=>`<tr>${cell('When',when(s,e.at))}${cell('Guest',h(guestName(e.guestId)))}${cell('Event',h(e.type))}${cell('Allocation',h(e.funding))}</tr>`).join(''))}</div></details>` : '';
  return panel('Guest passes',body(allowances+permissions)+grants+body(prepare)+drafts+seats+events,{id:'guests',icon:'users'});
}

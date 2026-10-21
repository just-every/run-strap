import { packName } from './facts'
import { money, when, zoneOf } from './format'
import { packExpiration } from './pack-history'
import { body, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, statusPill, textarea } from './shared'

const path = '/app/packs#freezes'
const identity = () => hidden('requestId',crypto.randomUUID())
const channel = () => select('channel','Request received by',[['desk','At the desk'],['phone','Phone'],['inbox','Email or inbox']],'desk')
const dateTime = (prefix: string, label: string, required = false) => `<div class="row2">${field(prefix+'Date',label+' date','','date',required ? 'required' : '')}${field(prefix+'Time',label+' time','','time',`step="1" ${required ? 'required' : ''}`)}</div>`
const exact = (s: any, at: string | null) => at ? packExpiration(s,at) : 'Agreed when staff end the freeze'
function preview(s: any, freeze: any, staff: boolean) {
  const e = freeze.effects
  const bookings = e.bookings.length ? `<ul>${e.bookings.map((b: any) => `<li>${h(b.title)} · ${exact(s,b.start)}: ${h(b.effect)}; no cancellation fee.</li>`).join('')}</ul>` : '<p>No future bookings are affected.</p>'
  const approval = staff && freeze.status === 'preview' && !freeze.stale ? form('freeze.confirm',path,hidden('id',freeze.id)+hidden('key',freeze.key)+identity()+channel(),'Approve this exact freeze') : ''
  const end = staff && ['scheduled','active'].includes(freeze.status) ? `<details><summary>End this freeze earlier</summary><p>Choose a future agreed resumption instant. The preview shows the revised expiry and invoice. Previously cancelled classes stay cancelled.</p>${form('freeze.end.prepare',path,
    hidden('id',freeze.id)+dateTime('end','Earlier resumption',true)+textarea('reason','Reason for earlier resumption','','required maxlength="500"')+identity()+channel(),'Preview earlier resumption','quiet')}</details>` : ''
  return `<article data-freeze="${h(freeze.id)}"><h3>${h(staff ? person(s,freeze.personId)+' · ' : '')}${h(freeze.typeName)} · ${statusPill(freeze.stale ? 'stale' : freeze.status)}</h3>`
    + `<p>${exact(s,freeze.startAt)} → ${exact(s,freeze.endAt)}</p><p>Reason: ${h(freeze.reason)}</p>`
    + `<p><strong>Freeze fee ${money(freeze.feeCents)}, added to the studio balance once. No payment is collected.</strong></p>`
    + `<p>Term expiry: ${exact(s,e.originalExpiresAt)} → ${exact(s,e.revisedExpiresAt)}. Existing credits and visits stay allocated, except the classes listed below whose original funding returns once.</p>`
    + `<p>${h(e.access)}</p><p>${h(e.billing)}</p>`
    + (e.originalRenewalAt ? `<p>Next invoice: ${exact(s,e.originalRenewalAt)} → ${exact(s,e.revisedRenewalAt)} · ${money(e.renewalAmountCents)}. No scheduled card or bank collections.</p>` : '')
    + `<p>Available credits at preview: ${h(e.remainingCredits)}. ${h(e.creditsReturned)} credit(s) return across the affected packs; visit holds return to their original plan.</p>`
    + bookings + (freeze.exceptionReason ? `<p>Studio-approved exception: ${h(freeze.exceptionReason)}</p>` : '')
    + (freeze.stale ? '<p>This preview is stale. Prepare another preview before approving.</p>' : '')
    + (freeze.resumedAt ? `<p>Resumed once at ${exact(s,freeze.resumedAt)}.</p>` : '') + approval + end + '</article>'
}
function recurringPanel(s: any, choices: [unknown,unknown][], staff: boolean) {
  const data = s.recurring ?? {terms:[],invoices:[]}
  const prepare = staff && choices.length > 1 ? `<details><summary>Propose recurring studio invoices</summary><p>The member must explicitly agree before any renewal invoice can be created. This authorizes invoices on the studio balance; it does not authorize card or bank debits.</p>${form('plan.recurring.prepare',path,
    select('packId','Plan for recurring invoices',choices)+field('intervalMonths','Calendar months per invoice','1','number','required min="1" max="12" step="1"')+identity()+channel(),'Preview recurring invoices','quiet')}</details>` : ''
  const terms = data.terms.map((r: any) => `<article data-recurring="${h(r.id)}"><h3>Recurring studio invoices · ${statusPill(r.stale ? 'stale' : r.status)}</h3>`
    + `<p>${h(staff ? person(s,r.personId)+': ' : '')}${money(r.amountCents)} every ${h(r.intervalMonths)} calendar month(s), on the agreed ${h(r.timeZone)} clock. ${r.entitlement && r.entitlement.kind !== 'credits' ? 'The existing visit plan continues each term.' : `${h(r.credits)} credits per new term; unused old credits expire under the old term.`}</p>`
    + `<p>Next invoice ${exact(s,r.nextRenewalAt)}. ${h(r.consent)}</p>`
    + (!staff && r.status === 'preview' && !r.stale ? form('plan.recurring.accept',path,hidden('id',r.id)+hidden('key',r.key),'I agree to these recurring invoices') : '')
    + (['active','needs_review','needs_reconnection','preview'].includes(r.status) ? form('plan.recurring.stop',path,hidden('id',r.id)+identity()+textarea('reason','Reason for stopping future invoices','','required maxlength="500"')+(staff ? channel() : ''),'Stop future invoices','quiet') : '')
    + (r.acceptedAt ? `<p>Member agreed ${when(s,r.acceptedAt)}.</p>` : '') + (r.failure ? `<p>Stopped for studio review: ${h(r.failure.replace(/_/g,' '))}.</p>` : '') + '</article>').join('')
  const invoices = data.invoices.map((i: any) => `<p data-recurring-invoice="${h(i.id)}">Renewal invoice · ${exact(s,i.dueAt)} · ${money(i.amountCents)} added to the studio balance. ${statusPill(i.status)} · No payment collected.</p>`).join('')
  return prepare + terms + invoices
}
export function freezesPanel(s: any, chosen = '') {
  const staff = owner(s), data = s.freezes ?? {types:[],requests:[],freezes:[],ends:[]}
  const livePacks = rows(s,'packs').filter(p => p.expiresAt > new Date().toISOString() && (!chosen || p.personId === chosen))
  const choices: [unknown,unknown][] = [['','Choose a plan'],...livePacks.map(p => [p.id,`${staff ? person(s,p.personId)+' · ' : ''}${packName(p)}`] as [unknown,unknown])]
  const types = data.types.map((t: any) => `<details data-freeze-type="${h(t.id)}"><summary>${staff ? 'Freeze directly: ' : 'Request a freeze: '}${h(t.name)}</summary>`
    + `<p>Default ${h(t.defaultLengthDays)} days · ${money(t.feeCents)} fee · up to ${h(t.maxLengthDays)} days. Allowed start days: ${t.allowedStartDays.map((n: number) => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][n-1]).join(', ')}. Studio clock: ${h(zoneOf(s) ?? 'UTC')}.</p>`
    + form(staff ? 'freeze.prepare' : 'freeze.request',path,select('packId','Plan to freeze',choices)+hidden('freezeTypeId',t.id)
      + dateTime('start','Freeze starts',true)+dateTime('end','Resumption',!staff)
      + (staff ? `<p>Leave resumption blank to use ${h(t.defaultLengthDays)} days, or choose open-ended.</p>${select('openEnded','Resumption agreement',[['no','Use the dates or default length'],['yes','Open-ended until staff agree an end']],'no')}${field('freezeFee','Freeze fee',(t.feeCents/100).toFixed(2),'text','required inputmode="decimal"')}` : '')
      + textarea('reason','Freeze reason',t.reason,'required maxlength="500"')
      + (staff ? textarea('exceptionReason','Exception approval reason (required for changes outside policy)','','maxlength="500"')+channel() : '')+identity(),staff ? 'Preview direct freeze' : 'Request these freeze dates','quiet')+'</details>').join('')
  const requests = data.requests.filter((r: any) => !chosen || r.personId === chosen).map((r: any) => `<article data-freeze-request="${h(r.id)}"><h3>${h(staff ? person(s,r.personId)+' · ' : '')}Freeze request · ${statusPill(r.status)}</h3><p>${h(r.reason)} · ${exact(s,r.startAt)} → ${exact(s,r.endAt)}</p>`
    + (staff && r.status === 'requested' ? form('freeze.prepare',path,hidden('freezeRequestId',r.id)+hidden('packId',r.packId)+textarea('exceptionReason','Exception approval reason (if required)','','maxlength="500"')+identity()+channel(),'Preview requested freeze','quiet') : '')+'</article>').join('')
  const freezes = data.freezes.filter((f: any) => !chosen || f.personId === chosen).map((f: any) => preview(s,f,staff)).join('')
  const ends = data.ends.filter((e: any) => !chosen || e.personId === chosen).map((e: any) => `<article data-freeze-end="${h(e.id)}"><h3>Earlier resumption · ${statusPill(e.stale ? 'stale' : e.status)}</h3><p>Resume ${exact(s,e.endAt)}. Term expiry ${exact(s,e.revisedExpiresAt)}${e.revisedRenewalAt ? `; next invoice ${exact(s,e.revisedRenewalAt)} for ${money(e.renewalAmountCents)}` : ''}. No additional fee; cancelled bookings stay cancelled.</p>`
    + (staff && e.status === 'preview' && !e.stale ? form('freeze.end.confirm',path,hidden('id',e.id)+hidden('key',e.key)+identity()+channel(),'Approve this earlier resumption') : '')+'</article>').join('')
  const manage = staff ? `<details><summary>Define a freeze type</summary>${form('freeze.type.save',path,field('name','Freeze type name','','text','required maxlength="100"')+textarea('reason','Default freeze reason','','required maxlength="500"')
    + field('freezeFee','Default freeze fee','0.00','text','required inputmode="decimal"')+field('defaultLengthDays','Default days','30','number','required min="1" max="366"')+field('maxLengthDays','Maximum days','366','number','required min="1" max="3660"')
    + field('allowedStartDaysText','Allowed start days (Monday 1 to Sunday 7)','1,2,3,4,5,6,7','text','required')+select('allowOpenEnded','Open-ended within policy',[['no','No; exception approval required'],['yes','Yes']],'no'),'Save freeze type','quiet')}</details>` : ''
  return panel('Freezes and recurring invoices',body(`<p>${staff ? 'Review a member request or freeze a plan directly. Only a human owner can approve the exact effects.' : 'Request dates and a reason. The studio reviews the exact fee, access, renewal and class effects before approving.'}</p>`
    + manage + (types || emptyLine('The studio has not defined a freeze type.'))+requests+freezes+ends+recurringPanel(chosen ? {...s,recurring:{terms:(s.recurring?.terms ?? []).filter((r: any) => r.personId === chosen),invoices:(s.recurring?.invoices ?? []).filter((r: any) => r.personId === chosen)}} : s,choices,staff)),{id:'freezes',icon:'card',className:staff ? 'desk-form' : ''})
}

import { packName } from './facts'
import { money, when, zoneOf } from './format'
import { packExpiration } from './pack-history'
import { recurringPanel } from './contract-invoices'
import { body, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, statusPill, textarea } from './shared'

const path = '/app/packs#freezes'
const identity = () => hidden('requestId',crypto.randomUUID())
const channel = () => select('channel','Request received by',[['desk','At the desk'],['phone','Phone'],['inbox','Email or inbox']],'desk')
const freezeDate = (prefix: string, label: string, required = false) => field(prefix+'Date',label+' date','','date',required ? 'required' : '')
const exact = (s: any, at: string | null) => at ? packExpiration(s,at) : 'Agreed when staff end the freeze'
function preview(s: any, freeze: any, staff: boolean, back: string) {
  const e = freeze.effects
  const currentExpiry = rows(s,'packs').find(p=>p.id===freeze.packId)?.expiresAt
  const appliedWithdrawal = freeze.status === 'withdrawn' && !!freeze.confirmedAt
  const closedPreview = ['withdrawn','declined'].includes(freeze.status) && !freeze.confirmedAt
  const feeEffect = appliedWithdrawal ? 'reversed once after withdrawal' : closedPreview ? 'not charged; this preview was closed' : freeze.confirmedAt ? 'added to the studio balance once' : 'added to the studio balance once only if approved'
  const bookings = e.bookings.length ? `<ul>${e.bookings.map((b: any) => `<li>${h(b.title)} · ${exact(s,b.start)}: ${h(b.effect)}; no cancellation fee.</li>`).join('')}</ul>` : '<p>No future bookings are affected.</p>'
  const needsAcceptance = freeze.requiresAcceptance && !freeze.acceptedAt
  const acceptance = freeze.status === 'preview' && !freeze.stale && needsAcceptance
    ? staff ? '<p>The member must accept this exact fee, dates and class effects before approval.</p>'+form('freeze.accept.launch',back,hidden('id',freeze.id)+identity()+channel(),'Open member freeze acceptance','quiet')
      : form('freeze.accept',back,hidden('id',freeze.id)+hidden('key',freeze.key),'I accept this exact freeze') : ''
  const approval = staff && freeze.status === 'preview' && !freeze.stale && !needsAcceptance ? form('freeze.confirm',back,hidden('id',freeze.id)+hidden('key',freeze.key)+identity()+channel(),'Approve this exact freeze') : ''
  const end = staff && ['scheduled','active'].includes(freeze.status) ? `<details><summary>End this freeze earlier</summary><p>Choose a future resumption day on the studio clock. The member must accept the revised expiry and invoice before approval. Previously cancelled classes stay cancelled.</p>${form('freeze.end.prepare',back,
    hidden('id',freeze.id)+freezeDate('end','Earlier resumption',true)+textarea('reason','Reason for earlier resumption','','required maxlength="500"')+identity()+channel(),'Preview earlier resumption','quiet')}</details>` : ''
  const withdrawal = freeze.withdrawal
  const withdraw = withdrawal ? `<details data-freeze-withdrawal="${h(freeze.id)}"><summary>Withdraw scheduled freeze</summary><p>Term expiry returns to ${exact(s,withdrawal.revisedExpiresAt)}. ${money(withdrawal.feeReversedCents)} of freeze fees reverses once. Previously cancelled classes stay cancelled.</p>`
    + (withdrawal.bookings.length ? `<p>These newer bookings will be cancelled, returning their original funding once:</p><ul>${withdrawal.bookings.map((b: any)=>`<li>${h(b.title)} · ${exact(s,b.start)}</li>`).join('')}</ul>` : '<p>No newer bookings need cancelling.</p>')
    + form('freeze.withdraw',back,hidden('id',freeze.id)+hidden('withdrawKey',withdrawal.key)+identity()+(staff ? textarea('reason','Reason for withdrawing freeze','','required maxlength="500"')+channel() : ''),'Withdraw this scheduled freeze','quiet')+'</details>' : ''
  return `<article data-freeze="${h(freeze.id)}"><h3>${h(staff ? person(s,freeze.personId)+' · ' : '')}${h(freeze.typeName)} · ${statusPill(freeze.stale ? 'stale' : freeze.status)}</h3>`
    + `<p>${exact(s,freeze.startAt)} → ${exact(s,freeze.endAt)}</p><p>Reason: ${h(freeze.reason)}</p>`
    + `<p><strong>Freeze fee ${money(freeze.feeCents)}, ${feeEffect}. No payment is collected.</strong></p>`
    + (closedPreview ? '<p>The request was closed before approval. No fee, booking or term date changed.</p>' : appliedWithdrawal ? `<p>The scheduled freeze was withdrawn. Its fee and date moves were reversed once.${currentExpiry ? ' Current term expiry: '+exact(s,currentExpiry)+'.' : ''} Previously cancelled classes stay cancelled.</p>` : `<p>Term expiry: ${exact(s,e.originalExpiresAt)} → ${exact(s,e.revisedExpiresAt)}. Added days grant no new period allowance. Existing credits and visits stay allocated, except the classes listed below whose original funding returns once.</p>`)
    + (closedPreview ? '' : appliedWithdrawal ? '<p>The plan can fund eligible classes again under its restored expiry.</p>' : `<p>${h(e.access)}</p><p>${h(e.billing)}</p>`)
    + (e.originalRenewalAt && !appliedWithdrawal && !closedPreview ? `<p>Next invoice: ${exact(s,e.originalRenewalAt)} → ${exact(s,e.revisedRenewalAt)} · ${money(e.renewalAmountCents)}. No scheduled card or bank collections.</p>` : '')
    + `<p>Available credits at preview: ${h(e.remainingCredits)}. ${h(e.creditsReturned)} credit(s) return across the affected packs; visit holds return to their original plan.</p>`
    + (closedPreview ? '' : bookings) + (freeze.exceptionReason ? `<p>Studio-approved exception: ${h(freeze.exceptionReason)}</p>` : '')
    + (freeze.stale ? '<p>This preview is stale. Prepare another preview before approving.</p>' : '')
    + (freeze.acceptedAt ? `<p>The member accepted this exact preview ${when(s,freeze.acceptedAt)}.</p>` : '')
    + (freeze.resumedAt ? `<p>Resumed once at ${exact(s,freeze.resumedAt)}.</p>` : '') + acceptance + approval + end + withdraw + '</article>'
}
export function freezesPanel(s: any, chosen = '', back = path) {
  const staff = owner(s) || ['front-desk','manager'].includes(s.actor.role), data = s.freezes ?? {types:[],requests:[],freezes:[],ends:[]}
  const livePacks = rows(s,staff && !owner(s) ? 'freezePacks' : 'packs').filter(p => p.expiresAt > new Date().toISOString() && (!chosen || p.personId === chosen))
  const choices: [unknown,unknown][] = [['','Choose a plan'],...livePacks.map(p => [p.id,`${staff ? person(s,p.personId)+' · ' : ''}${packName(p)}`] as [unknown,unknown])]
  const types = data.types.map((t: any) => `<details data-freeze-type="${h(t.id)}"><summary>${staff ? 'Freeze directly: ' : 'Request a freeze: '}${h(t.name)}</summary>`
    + `<p>Default ${h(t.defaultLengthDays)} days · ${money(t.feeCents)} fee · up to ${h(t.maxLengthDays)} days. ${t.maxFreezes ? 'Maximum '+h(t.maxFreezes)+' freezes per rolling 365 days. ' : ''}${t.maxDays ? 'Maximum '+h(t.maxDays)+' frozen days per rolling 365 days. ' : ''}Allowed start days: ${t.allowedStartDays.map((n: number) => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][n-1]).join(', ')}. Studio clock: ${h(zoneOf(s) ?? 'UTC')}.</p>`
    + form(staff ? 'freeze.prepare' : 'freeze.request',back,select('packId','Plan to freeze',choices)+hidden('freezeTypeId',t.id)
      + freezeDate('start','Freeze starts',true)+freezeDate('end','Resumption',!staff)
      + (staff ? `<p>Leave resumption blank to use ${h(t.defaultLengthDays)} days, or choose open-ended.</p>${select('openEnded','Resumption agreement',[['no','Use the dates or default length'],['yes','Open-ended until staff agree an end']],'no')}${field('freezeFee','Freeze fee',(t.feeCents/100).toFixed(2),'text','required inputmode="decimal"')}` : '')
      + textarea('reason','Freeze reason',t.reason,'required maxlength="500"')
      + (staff ? textarea('exceptionReason','Exception approval reason (required for changes outside policy)','','maxlength="500"')+channel() : '')+identity(),staff ? 'Preview direct freeze' : 'Request these freeze dates','quiet')+'</details>').join('')
  const requests = data.requests.filter((r: any) => !chosen || r.personId === chosen).map((r: any) => `<article data-freeze-request="${h(r.id)}"><h3>${h(staff ? person(s,r.personId)+' · ' : '')}Freeze request · ${statusPill(r.status)}</h3><p>${h(r.reason)} · ${exact(s,r.startAt)} → ${exact(s,r.endAt)}</p>`
    + (r.declineReason || r.withdrawalReason ? `<p>${h(r.declineReason ?? r.withdrawalReason)}</p>` : '')
    + (staff && r.status === 'requested' ? form('freeze.prepare',back,hidden('freezeRequestId',r.id)+hidden('packId',r.packId)+textarea('exceptionReason','Exception approval reason (if required)','','maxlength="500"')+identity()+channel(),'Preview requested freeze','quiet')
      + `<details><summary>Decline this request</summary>${form('freeze.decline',back,hidden('id',r.id)+identity()+textarea('reason','Reason for declining freeze request','','required maxlength="500"')+channel(),'Decline freeze request','quiet')}</details>` : '')
    + (r.status === 'requested' ? form('freeze.request.withdraw',back,hidden('id',r.id)+identity()+(staff ? textarea('reason','Reason for withdrawing request','','required maxlength="500"')+channel() : ''),'Withdraw freeze request','quiet') : '')+'</article>').join('')
  const freezes = data.freezes.filter((f: any) => !chosen || f.personId === chosen).map((f: any) => preview(s,f,staff,back)).join('')
  const ends = data.ends.filter((e: any) => !chosen || e.personId === chosen).map((e: any) => `<article data-freeze-end="${h(e.id)}"><h3>Earlier resumption · ${statusPill(e.stale ? 'stale' : e.status)}</h3><p>Resume ${exact(s,e.endAt)}. Term expiry ${exact(s,e.revisedExpiresAt)}${e.revisedRenewalAt ? `; next invoice ${exact(s,e.revisedRenewalAt)} for ${money(e.renewalAmountCents)}` : ''}. No additional fee; cancelled bookings stay cancelled.</p>`
    + (e.acceptedAt ? `<p>The member accepted this exact earlier resumption ${when(s,e.acceptedAt)}.</p>` : '')
    + (e.status === 'preview' && !e.stale && !e.acceptedAt ? staff ? '<p>The member must accept this exact earlier resumption before approval.</p>'+form('freeze.end.accept.launch',back,hidden('id',e.id)+identity()+channel(),'Open member resumption acceptance','quiet') : form('freeze.end.accept',back,hidden('id',e.id)+hidden('key',e.key),'I accept this exact earlier resumption') : '')
    + (staff && e.status === 'preview' && !e.stale && e.acceptedAt ? form('freeze.end.confirm',back,hidden('id',e.id)+hidden('key',e.key)+identity()+channel(),'Approve this earlier resumption') : '')+'</article>').join('')
  const manage = owner(s) ? `<details><summary>Define a freeze type</summary>${form('freeze.type.save',back,field('name','Freeze type name','','text','required maxlength="100"')+textarea('reason','Default freeze reason','','required maxlength="500"')
    + field('freezeFee','Default freeze fee','0.00','text','required inputmode="decimal"')+field('defaultLengthDays','Default days','30','number','required min="1" max="366"')+field('maxLengthDays','Maximum days','366','number','required min="1" max="3660"')
    + field('maxFreezes','Maximum freezes per rolling 365 days (optional)','','number','min="1" step="1"')+field('maxDays','Maximum frozen days per rolling 365 days (optional)','','number','min="1" step="1"')
    + field('allowedStartDaysText','Allowed start days (Monday 1 to Sunday 7)','1,2,3,4,5,6,7','text','required')+select('allowOpenEnded','Open-ended within policy',[['no','No; exception approval required'],['yes','Yes']],'no'),'Save freeze type','quiet')}</details>` : ''
  return panel('Freezes and recurring invoices',body(`<p>${staff ? 'Review a member request or freeze a plan directly. A staff member with current contract-change and member-record rights approves the exact effects.' : 'Request dates and a reason. Review and accept any fee or changed terms before the studio approves.'} Freeze dates are whole days on the studio clock. A freeze does not replace disability or relocation cancellation.</p>`
    + manage + (types || emptyLine('The studio has not defined a freeze type.'))+requests+freezes+ends+(owner(s) || !staff ? recurringPanel(chosen ? {...s,recurring:{terms:(s.recurring?.terms ?? []).filter((r: any) => r.personId === chosen),invoices:(s.recurring?.invoices ?? []).filter((r: any) => r.personId === chosen)}} : s,choices,staff) : '')),{id:'freezes',icon:'card',className:staff ? 'desk-form' : ''})
}

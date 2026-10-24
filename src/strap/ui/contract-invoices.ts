import { money, when } from './format'
import { packExpiration } from './pack-history'
import { field, form, h, hidden, person, select, statusPill, textarea } from './shared'
import { acceptancePresenceText } from '../domain/contract-sale-context'

const path = '/app/packs#freezes'
const identity = () => hidden('requestId',crypto.randomUUID())
const channel = () => select('channel','Request received by',[['desk','At the desk'],['phone','Phone'],['inbox','Email or inbox']],'desk')
const exact = (s: any, at: string) => packExpiration(s,at)
const saleContext = (r: any) => `<p data-contract-sale-context>Acceptance setting: ${r.contractAcceptanceChannel === 'in-person' ? 'In person at the studio'+(r.acceptedAt ? '' : ', subject to your confirmation') : r.contractAcceptanceChannel === 'online' || !r.acceptedAt ? 'Online' : 'Unrecorded (off-premises)'}. Studio opening date: ${h(r.studioOpenedOn ?? 'not recorded')}.${r.studioOpeningEvidenceReference ? ` Opening evidence reference: ${h(r.studioOpeningEvidenceReference)}.` : ''}${r.acceptanceEvidenceReference ? ` Physical-presence evidence reference: ${h(r.acceptanceEvidenceReference)}.` : ''} In-person acceptance before the studio opens, or without a recorded opening date, keeps off-premises cooling-off rights.</p>`
const acceptancePresence = () => `<label class="check"><input type="checkbox" name="acceptancePresent" value="yes" required> ${h(acceptancePresenceText)}</label>`

/** The member's stop link lands directly on a one-step POST form. */
export function recurringPanel(s: any, choices: [unknown,unknown][], staff: boolean) {
  const data = s.recurring ?? {terms:[],invoices:[]}, connection = data.connection
  const reconnect = staff && connection?.canReconnect ? `<details open><summary>Reconnect recurring invoices to this studio address</summary><p>The live studio address changed from ${h(connection.origin)} to ${h(connection.currentOrigin)}. Existing member acceptances keep their agreed amount and interval. Each affected member receives one notice.</p>${form('plan.recurring.reconnect',path,
    hidden('previousOrigin',connection.origin)+hidden('connectionId',connection.connectionId)+identity()+channel(),'Reconnect existing invoice agreements','quiet')}</details>` : ''
  const fresh = staff && data.terms.some((r: any) => r.requiresFreshAcceptance && r.acceptedAt && r.status !== 'stopped')
    ? '<p>Restored invoice agreements need fresh member acceptance. Propose new exact terms for the member; reconnecting the studio address cannot resume a restored agreement.</p>' : ''
  const prepare = staff && choices.length > 1 ? `<details><summary>Propose recurring studio invoices</summary><p>The member must explicitly agree to the exact amount, interval, first due date and stop link. Invoices continue until stopped and add debt to the studio balance. No card or bank payment is authorized or collected.</p>${form('plan.recurring.prepare',path,
    select('packId','Plan for recurring invoices',choices)+field('intervalMonths','Calendar months per invoice','1','number','required min="1" max="120" step="1"')+select('contractAcceptanceChannel','Where the member will accept',[['online','Online'],['in-person','In person at the studio']],'online')+field('acceptanceEvidenceReference','Physical-presence evidence reference (required for in-person)','','text','maxlength="200"')+'<p>The member must accept through their own account. An in-person proposal requires a reference documenting physical presence and the member’s explicit confirmation at acceptance.</p>'+identity()+channel(),'Preview recurring invoices','quiet')}</details>` : ''
  const terms = data.terms.map((r: any) => {
    const stop = ['active','needs_review','needs_reconnection','preview'].includes(r.status) ? form('plan.recurring.stop',r.stopPath,
      hidden('id',r.id)+identity()+(staff ? textarea('reason','Reason for stopping future invoices','','required maxlength="500"')+channel() : ''),'Stop future invoices now','quiet') : ''
    return `<article id="recurring-${h(r.id)}" data-recurring="${h(r.id)}"><h3>Recurring studio invoices · ${statusPill(r.stale ? 'stale' : r.status)}</h3>`
      + `<p>${h(staff ? person(s,r.personId)+': ' : '')}${money(r.amountCents)} every ${h(r.intervalMonths)} calendar month(s), on the agreed ${h(r.timeZone)} clock. ${r.entitlement && r.entitlement.kind !== 'credits' ? 'The existing visit plan continues each term.' : `${h(r.credits)} credits per new term; unused old credits expire under the old term.`}</p>`
      + `<p>First invoice ${r.firstDueAt ? exact(s,r.firstDueAt) : 'Original first due date was not retained'}. Next invoice ${exact(s,r.nextRenewalAt)}. Invoices continue until stopped.</p>`
      + `<p data-recurring-consent="${h(r.id)}">${h(r.consent)}</p><p><a href="${h(r.stopPath)}">Stop future invoices in one step</a>. Stopping is effective immediately, without a member reason. Access continues to the current term end.</p>`
      + saleContext(r)
      + (staff && r.status === 'preview' && r.contractAcceptanceChannel === 'in-person' ? `<p>The member’s required checkbox says: “${h(acceptancePresenceText)}”</p>` : '')
      + (!staff && r.status === 'preview' && !r.stale ? form('plan.recurring.accept',r.stopPath,hidden('id',r.id)+hidden('key',r.key)+(r.contractAcceptanceChannel === 'in-person' ? acceptancePresence() : ''),'I agree to these recurring invoices') : '')
      + (staff && r.status==='active' ? `<details><summary>Schedule renewal disclosure</summary><p>Choose the notice lead time. A proposed price is informational; the existing accepted price continues until the member stops or accepts a separate plan change.</p>${form('plan.disclosure.schedule',path,hidden('termsId',r.id)+field('leadDays','Days before renewal','30','number','required min="15" max="365"')+field('proposedAmount','Proposed future price (optional)','','text','inputmode="decimal"')+identity()+channel(),'Schedule disclosure','quiet')}</details>` : '')
      + stop
      + (r.acceptedAt ? `<p>Member agreed ${when(s,r.acceptedAt)} through ${h(r.acceptedChannel)}.${r.acceptancePresent ? ` Confirmed: ${h(r.acceptancePresenceText)} Physical presence confirmed ${when(s,r.acceptedAt)}.` : ''}</p><p data-recurring-acknowledgement="${h(r.id)}">Acknowledgment: ${h(r.acknowledgement?.text)}</p>` : '')
      + (r.stoppedAt ? `<p>Stopped immediately ${when(s,r.stoppedAt)}. Access continues to the existing term end.</p>` : '')
      + (r.failure ? `<p>Studio review required: ${h(r.failure.replace(/_/g,' '))}.</p>` : '') + '</article>'
  }).join('')
  const invoices = data.invoices.map((i: any) => `<p data-recurring-invoice="${h(i.id)}">Renewal invoice · ${exact(s,i.dueAt)} · ${money(i.amountCents)} ${i.status==='void'?'invoice void; unpaid '+money(i.voidedUnpaidCents)+' reversed':'added to the studio balance'}. ${statusPill(i.status)} · No payment collected.</p>`).join('')
  const disclosures=(s.renewalDisclosures ?? []).filter((d:any)=>data.terms.some((r:any)=>r.id===d.termsId)).map((d:any)=>`<article data-renewal-disclosure="${h(d.id)}"><h3>Renewal disclosure · ${statusPill(d.status)}</h3><p>Notice ${exact(s,d.sendAt)} · invoice ${exact(s,d.dueAt)} · accepted price ${money(d.currentAmountCents)}.${d.proposedAmountCents===null?'':' Proposed future price '+money(d.proposedAmountCents)+'.'}</p><p>${h(d.body ?? d.policy)}</p>${d.delivery?'<p>Email: '+h(d.delivery.status.replace(/_/g,' '))+'. The in-app notice is retained.</p>':''}<a href="${h(d.stopPath)}">Review terms and stop future invoices</a>${staff&&d.status==='scheduled'?form('plan.disclosure.cancel',path,hidden('id',d.id)+identity()+channel(),'Cancel scheduled disclosure','quiet'):''}</article>`).join('')
  return reconnect + fresh + prepare + terms + invoices + disclosures
}

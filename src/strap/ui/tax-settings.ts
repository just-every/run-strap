import { taxAddressFields } from './tax-fields'
import { body, cell, field, form, h, hidden, panel, select, table } from './shared'
import { money } from './format'
import { taxOperations } from './tax-operations'

const consent='<label class="check"><input type="checkbox" name="consent" value="yes" required>I reviewed these test tax settings and authorize this connection.</label>'
const common=(config: any)=>hidden('requestId',crypto.randomUUID())+hidden('products',JSON.stringify(config?.products ?? []))+hidden('exemptions',JSON.stringify(config?.exemptions ?? []))
const retained=(config: any)=>common(config)+hidden('originAddress',JSON.stringify(config.originAddress))+hidden('registeredStates',config.registeredStates.join(','))

/** Tax configuration belongs with the studio settings; each outbound operation is explicit. */
export function taxSettingsPanel(s: any) {
  if(s.actor.role!=='owner')return ''
  if(!s.tax)return panel('Sales tax',body('<p><a href="/app/security">Complete second-factor verification</a> to open tax settings.'),{id:'tax'})
  const tax=s.tax,config=tax.config
  const products=config?.products ?? [],sources:[string,string][]=[
    ...(s.retail?.skus ?? []).map((p: any)=>['retail:'+p.id,p.name+' · '+p.variant+' (retail)'] as [string,string]),
    ...(s.packs ?? []).map((p: any)=>['service:'+p.id,(p.entitlement?.name ?? 'Class pack')+' · '+(s.people.find((v: any)=>v.id===p.personId)?.name ?? 'Member')+' · '+money(p.purchaseAmountCents ?? p.amountCents)] as [string,string])]
  const configForm=sources.length ? form('tax.config.save','/app/studio#tax',common(config)
    +taxAddressFields('origin',config?.originAddress)+field('registeredStates','Registered states',config?.registeredStates.join(', '),'text','required placeholder="CA, WA"')
    +select('productSource','Product or service',[['','Choose a recorded product'],...sources],'','required')
    +field('productLabel','Classification label','','text','required maxlength="160"')
    +field('taxCode','Stripe product tax code','','text','required pattern="txcd_[0-9]{8}" placeholder="txcd_99999999"')+consent,'Review and connect test tax')
    : '<p>Record a retail product or service sale before assigning its tax treatment.</p>'
  const classified=products.map((p: any)=>`<tr>${cell('Product',h(p.label))}${cell('Kind',h(p.kind))}${cell('Tax category',h(p.taxCode))}</tr>`).join('')
  const exemptions=config ? `<details><summary>Recorded exemptions</summary>${table(['Member','Evidence','Reason'],config.exemptions.map((e: any)=>`<tr>${cell('Member',h(s.people.find((p: any)=>p.id===e.personId)?.name ?? 'Member'))}${cell('Evidence',h(e.reference))}${cell('Reason',h(e.reason))}</tr>`).join('') || '<tr><td colspan="3">No exemptions recorded.</td></tr>')}`
    +form('tax.config.save','/app/studio#tax',retained(config)+select('exemptionPersonId','Exempt member',[['','Choose a member'],...s.people.filter((p: any)=>p.active&&p.role==='member').map((p: any)=>[p.id,p.name])],'','required')
      +field('exemptionReference','Exemption evidence reference','','text','required maxlength="160"')+field('exemptionReason','Exemption reason','','text','required maxlength="1000"')+consent,'Record exemption')+'</details>' : ''
  return panel('Sales tax',body('<p>Stripe Tax test mode. These test tax invoices add separate tax lines to the studio ledger; no payment is collected and no filing is submitted.</p>'
    +(!tax.configured ? '<p>The Stripe Tax test connection is not configured for this installation.</p>' : `<p>${tax.connected ? 'Test connection reviewed and active.' : 'Tax execution is disconnected until you review and connect these settings.'}</p><details><summary>${config ? 'Update classifications or reconnect' : 'Connect and classify a product'}</summary>${configForm}</details>`)
    +(classified ? `<div class="table-wrap">${table(['Product','Kind','Tax category'],classified)}</div>` : '')+exemptions
    +taxOperations(s,tax)),{id:'tax'})
}

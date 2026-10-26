import { cell, field, form, h, hidden, select, table, textarea } from './shared'
import { money } from './format'
import { taxAddressFields } from './tax-fields'

export function taxOperations(s: any,tax: any) {
  const config=tax.config
  if(!config)return ''
  const products=config.products
  const candidates=s.charges.flatMap((charge: any)=>products.filter((product: any)=>charge.amountCents>0&&!charge.taxInvoiceId&&!charge.reversesChargeId
    &&(product.kind==='service' ? charge.packId===product.sourceId&&!charge.reason&&!charge.kind : s.retail?.sales.some((sale: any)=>sale.id===charge.retailSaleId&&sale.skuId===product.sourceId)))
    .filter(()=>!tax.invoices.some((invoice: any)=>invoice.originalChargeId===charge.id))
    .map((product: any)=>[JSON.stringify([charge.id,product.id]),product.label+' · '+money(charge.amountCents)]))
  const calculate=tax.connected&&candidates.length ? `<details><summary>Calculate tax on a recorded sale</summary>${form('tax.calculate','/app/studio#tax',hidden('requestId',crypto.randomUUID())
    +select('taxSale','Recorded sale',[['','Choose a sale'],...candidates],'','required')+taxAddressFields('customer',config.originAddress)
    +select('exemptionId','Recorded exemption',[['','No exemption'],...config.exemptions.map((e: any)=>[e.id,(s.people.find((p: any)=>p.id===e.personId)?.name ?? 'Member')+' · '+e.reference])],'','')
    ,'Calculate test tax')}</details>` : ''
  const pending=tax.calculations.filter((c: any)=>!tax.invoices.some((i: any)=>i.calculationId===c.id))
  const previews=pending.map((c: any)=>`<tr data-tax-calculation="${h(c.id)}">${cell('Sale',h(c.product.label))}${cell('Original price',money(c.priceCents))}${cell('Tax',money(c.taxCents))}${cell('Total',money(c.totalCents))}${cell('Approval',tax.connected ? form('tax.confirm','/app/studio#tax',hidden('requestId',crypto.randomUUID())+hidden('calculationId',c.id)+hidden('expectedTaxCents',c.taxCents)+hidden('reference','strap-tax-'+c.id),'Record test tax invoice') : 'Disconnected')}</tr>`).join('')
  const invoices=tax.invoices.map((i: any)=>`<tr data-tax-invoice="${h(i.id)}">${cell('Sale',h(i.product.label))}${cell('Price',money(i.priceCents))}${cell('Tax',money(i.taxCents))}${cell('Provider reference',h(i.providerTransactionId))}</tr>`).join('')
  const reversals=tax.reversals.map((r: any)=>`<tr data-tax-reversal="${h(r.id)}">${cell('Original invoice',h(tax.invoices.find((i: any)=>i.id===r.invoiceId)?.product.label ?? r.invoiceId))}${cell('Returned price',money(r.priceCents))}${cell('Tax credit',money(r.taxCents))}${cell('Provider reference',h(r.providerTransactionId))}</tr>`).join('')
  const returns=(s.retail?.returns ?? []).flatMap((r: any)=>tax.invoices.filter((i: any)=>i.originalCharge.retailSaleId===r.saleId&&!tax.reversals.some((v: any)=>v.retailReturnId===r.id)).map((i: any)=>[JSON.stringify([i.id,r.id]),i.product.label+' · returned '+money(r.amountCents)]))
  const refund=tax.connected&&returns.length ? `<details><summary>Reverse tax for a recorded return</summary>${form('tax.refund','/app/studio#tax',hidden('requestId',crypto.randomUUID())+select('taxReturn','Returned sale',[['','Choose a return'],...returns],'','required')+field('expectedTaxCents','Expected tax credit (USD)','','text','required inputmode="decimal"')+field('reference','Reversal reference','','text','required maxlength="160"')+field('reason','Reason','','text','required maxlength="1000"'),'Record test tax reversal')}</details>` : ''
  const outcomes=tax.operations.map((op: any)=>`<li>${h(op.type)} · ${h(op.status)}${op.errorCode?' · '+h(op.errorCode.replaceAll('_',' ')):''}${['pending','uncertain'].includes(op.status)?' · No automatic retry; reconcile the provider outcome before another attempt.':''}</li>`).join('')
  return calculate+(previews ? `<h3>Tax previews</h3><div class="table-wrap">${table(['Sale','Original price','Tax','Total','Approval'],previews)}</div>` : '')
    +(invoices ? `<h3>Recorded test tax invoices</h3><div class="table-wrap">${table(['Sale','Price','Tax','Provider reference'],invoices)}</div>` : '')+refund
    +(reversals ? `<h3>Recorded test tax reversals</h3><div class="table-wrap">${table(['Original invoice','Returned price','Tax credit','Provider reference'],reversals)}</div>` : '')
    +`<p><a href="/api/strap/tax/filing.csv">Download tax evidence CSV</a></p>`
    +(outcomes ? `<details><summary>Tax operation history</summary><ul>${outcomes}</ul>${textarea('taxEvidence','Retained tax evidence',JSON.stringify({invoices:tax.invoices,reversals:tax.reversals},null,2),'readonly rows="10"')}</details>` : '')
}

import { cell, field, form, h, hidden, select, table } from './shared'
import { money } from './format'

/** External receipts retain their invoice or reversal; they never call a processor. */
export function taxPayments(tax: any) {
  const payments=tax.payments ?? [],choices:[string,string][]=[]
  for(const invoice of tax.invoices) {
    const recorded=payments.filter((p: any)=>p.taxInvoiceId===invoice.id)
    const received=recorded.filter((p: any)=>!p.taxReversalId).reduce((sum: number,p: any)=>sum+p.amountCents,0)
    const refunded=-recorded.filter((p: any)=>p.taxReversalId).reduce((sum: number,p: any)=>sum+p.amountCents,0)
    const reversals=tax.reversals.filter((r: any)=>r.invoiceId===invoice.id)
    const credited=-reversals.reduce((sum: number,r: any)=>sum+r.taxCents,0)
    const remaining=invoice.taxCents-credited+refunded-received
    if(remaining>0)choices.push([JSON.stringify([invoice.id,null]),invoice.product.label+' · receive up to '+money(remaining)+' · '+invoice.providerTransactionId])
    for(const reversal of reversals) {
      const returned=-recorded.filter((p: any)=>p.taxReversalId===reversal.id).reduce((sum: number,p: any)=>sum+p.amountCents,0)
      const available=Math.min(-reversal.taxCents-returned,received-refunded)
      if(available>0)choices.push([JSON.stringify([invoice.id,reversal.id]),invoice.product.label+' · refund up to '+money(available)+' · '+reversal.providerTransactionId])
    }
  }
  const recording=tax.connected&&choices.length ? `<details><summary>Record an external tax payment</summary><p>Record tax money already received or returned outside Strap. This does not collect or refund money through Stripe.</p>${form('tax.payment.record','/app/studio#tax',hidden('requestId',crypto.randomUUID())
    +select('taxPaymentSource','Tax invoice or reversal',[['','Choose a tax record'],...choices],'','required')
    +field('amountCents','Tax payment amount (USD)','','text','required inputmode="decimal"')
    +field('reference','External payment reference','','text','required maxlength="160"')
    +field('reason','Payment reason','','text','required maxlength="1000"'),'Record external tax payment')}</details>` : ''
  const rows=payments.map((p: any)=>`<tr data-tax-payment="${h(p.id)}">${cell('Sale',h(tax.invoices.find((i: any)=>i.id===p.taxInvoiceId)?.product.label ?? p.taxInvoiceId))}${cell('Amount',money(p.amountCents))}${cell('Reference',h(p.reference))}${cell('Reason',h(p.reason))}</tr>`).join('')
  return recording+(rows ? `<h3>Recorded external tax payments</h3><div class="table-wrap">${table(['Sale','Amount','Reference','Reason'],rows)}</div>` : '')
}

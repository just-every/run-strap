import { list, type RecordData, type State } from './domain/types'

/** Separate retained provider-classified tax from unclassified service and retail value. */
export function financeTax(state: State,at: number,charges: RecordData[]) {
  const invoices=list(state,'taxInvoice').filter(i=>Date.parse(i.createdAt)<at)
  const reversals=list(state,'taxReversal').filter(r=>Date.parse(r.createdAt)<at)
  const invoiceFor=(charge: RecordData)=>invoices.find(i=>i.originalChargeId===charge.id)
  const classified=new Set<string>()
  for(const invoice of invoices){
    const charge=charges.find(c=>c.id===invoice.taxChargeId)
    if(charge?.reason==='sales_tax' && charge.amountCents===invoice.taxCents && charge.taxInvoiceId===invoice.id)classified.add(charge.id)
  }
  for(const reversal of reversals){
    const charge=charges.find(c=>c.id===reversal.taxChargeId)
    if(charge?.reason==='sales_tax_reversal' && charge.amountCents===reversal.taxCents && charge.taxReversalId===reversal.id)classified.add(charge.id)
  }
  const unknown=charges.filter(c=>{
    if(classified.has(c.id) || c.reason==='gift_card_issue')return false
    if(c.reason==='retail_return')return !reversals.some(r=>r.refundChargeId===c.id)
    return !invoiceFor(c)
  }).map(c=>c.id)
  const knownTaxCents=charges.filter(c=>classified.has(c.id)).reduce((n,c)=>n+c.amountCents,0)
  return {classified,knownTaxCents,taxCents:unknown.length ? null : knownTaxCents,unavailableChargeIds:unknown,modes:[...new Set(invoices.map(i=>i.mode))]}
}

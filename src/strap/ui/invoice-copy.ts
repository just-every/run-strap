import { money } from './format'
import { addressText } from './locations'
import { phoneText } from './profile'
import { cell, h, table } from './shared'

export interface InvoiceLine {
  id: string; label: string; kind: string; amountCents: number; refundedCents: number; taxCents: number; discountCents: number
}
export interface InvoiceReceipt {
  id: string; amountCents: number; tender: string; status: string; reference: string; createdAt: string
  allocations: { lineId: string; amountCents: number }[]
}
export interface InvoiceDocument {
  id: string; packId: string; personId: string; memberName: string; currency: 'usd'; createdAt: string
  studio: { legalName: string; receiptDetails: string; address: unknown; phone: string; locationName: string; timeZone: string }
  lines: InvoiceLine[]; subtotalCents: number; taxCents: number; discountCents: number; totalCents: number
  externallyRecordedCents:number; collectedCents:number; disputedCents:number; pendingCents:number; paidCents: number; refundedCents: number; balanceCents: number; status: string; taxStatus: 'not_assessed' | 'retained_provider_evidence'; receipts: InvoiceReceipt[]
  refunds: { id: string; lineId: string; amountCents: number; tender: string; status: string; createdAt: string }[]
  canSend: boolean; canRefund: boolean; canAllocate: boolean
}

export const billingLabel = (value: string) => value.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase())
export const invoiceTime = (invoice: InvoiceDocument, at: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: invoice.studio.timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
}).format(new Date(at))

/** External records and provider confirmation remain distinct on every copy. */
export function settlementLabel(record: { tender: string; status: string }, refund = false) {
  const status = record.status.replace(/_/g, '-')
  if (['external', 'externally-recorded', 'recorded-externally'].includes(status)
    || (record.tender === 'external' && ['recorded', 'completed', 'paid', 'succeeded'].includes(status))) return (refund ? 'Refund recorded externally' : 'Externally recorded') + ' · settlement not verified'
  return (refund ? 'Refund ' : '') + billingLabel(record.status)
}

export const invoiceTaxNote = (invoice: InvoiceDocument) => invoice.taxStatus === 'retained_provider_evidence'
  ? 'Tax amounts are supported by retained provider evidence.' : 'Tax has not been assessed. A zero tax amount is not a tax exemption.'

export function invoiceIdentity(invoice: InvoiceDocument) {
  const studio = invoice.studio
  const address = typeof studio.address === 'string' ? studio.address : addressText(studio.address)
  return `<h3>${h(studio.legalName)}</h3><p>${h(studio.locationName)} · ${h(address)}${studio.phone ? ` · ${h(phoneText(studio.phone))}` : ''}</p>`
    + `<p>${h(invoice.memberName)} · <time datetime="${h(invoice.createdAt)}">${h(invoiceTime(invoice, invoice.createdAt))}</time></p>`
}

export function invoiceLines(invoice: InvoiceDocument) {
  return `<div class="table-wrap">${table(['Item', '>Amount (USD)', '>Discount (USD)', '>Tax (USD)', '>Refunded (USD)'], invoice.lines.map(line => `<tr data-invoice-line="${h(line.id)}">`
    + cell('Item', `${h(line.label)}<small>${h(billingLabel(line.kind))}</small>`)
    + cell('Amount (USD)', money(line.amountCents), 'right') + cell('Discount (USD)', money(line.discountCents), 'right')
    + cell('Tax (USD)', money(line.taxCents), 'right') + cell('Refunded (USD)', money(line.refundedCents), 'right') + '</tr>').join(''))}</div>`
}

export function invoiceTotals(invoice: InvoiceDocument) {
  const amounts: [string, number][] = [['Subtotal after discounts', invoice.subtotalCents], ['Discounts', invoice.discountCents], ['Tax', invoice.taxCents], ['Original invoice total', invoice.totalCents], ['Payments applied', invoice.paidCents], ['Externally recorded', invoice.externallyRecordedCents], ['Processor collected', invoice.collectedCents], ['Pending collection', invoice.pendingCents], ['Disputed', invoice.disputedCents], ['Refunded', invoice.refundedCents], ['Balance due', invoice.balanceCents]]
  return `<p>${h(invoiceTaxNote(invoice))}</p><div class="table-wrap">${table(['Summary', '>Amount (USD)'], amounts.map(([label, cents]) => `<tr>${cell('Summary', label)}${cell('Amount (USD)', `<strong>${money(cents)}</strong>`, 'right')}</tr>`).join(''))}</div>`
}

export function receiptDetails(invoice: InvoiceDocument, receipt: InvoiceReceipt) {
  const allocations = receipt.allocations.map(allocation => `<tr>${cell('Item', h(invoice.lines.find(line => line.id === allocation.lineId)?.label ?? allocation.lineId))}${cell('Applied (USD)', money(allocation.amountCents), 'right')}</tr>`).join('')
  return `<p><strong>${money(receipt.amountCents)} USD</strong> · ${h(billingLabel(receipt.tender))} · ${h(settlementLabel(receipt))}</p>`
    + `<p>Reference: ${h(receipt.reference)} · ${h(invoiceTime(invoice, receipt.createdAt))}</p>`
    + (allocations ? `<div class="table-wrap">${table(['Item', '>Applied (USD)'], allocations)}</div>` : '<p>No amount allocated to an invoice line.</p>')
}

export function invoiceRefunds(invoice: InvoiceDocument) {
  if (!invoice.refunds.length) return ''
  return `<h3>Refunds</h3><div class="table-wrap">${table(['Item', 'Recorded', 'Tender and status', '>Amount (USD)'], invoice.refunds.map(refund => `<tr>`
    + cell('Item', h(invoice.lines.find(line => line.id === refund.lineId)?.label ?? refund.lineId))
    + cell('Recorded', h(invoiceTime(invoice, refund.createdAt)))
    + cell('Tender and status', `${h(billingLabel(refund.tender))}<small>${h(settlementLabel(refund, true))}</small>`)
    + cell('Amount (USD)', money(refund.amountCents), 'right') + '</tr>').join(''))}</div>`
}

/** Standalone readable HTML used by the authorized invoice and receipt downloads. */
export function renderInvoiceCopy(invoice: InvoiceDocument, receipt?: InvoiceReceipt) {
  const title = receipt ? 'Payment receipt' : 'Invoice'
  const payments = receipt ? `<h2>Payment receipt</h2>${receiptDetails(invoice, receipt)}` : invoice.receipts.map(payment => `<section><h3>Payment receipt ${h(payment.id)}</h3>${receiptDetails(invoice, payment)}</section>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${h(receipt?.id ?? invoice.id)}</title><style>
  *{box-sizing:border-box}body{margin:0;color:#312738;background:#fff;font:15px/1.5 Figtree,Arial,sans-serif}main{max-width:960px;margin:32px auto;padding:24px}h1,h2,h3{font-family:Georgia,serif;color:#49364d}h1{font-size:30px}h2{font-size:23px}h3{font-size:19px}p,small,th,td{font-size:15px}small{display:block}table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #ddd6df;border-radius:8px;margin:16px 0}th,td{padding:12px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{background:#f3f5f1}.right{text-align:right}section{margin:24px 0}.table-wrap{overflow:auto}code{overflow-wrap:anywhere;font-size:15px}.details{white-space:pre-wrap}@media(max-width:600px){main{margin:0;padding:16px}table.stack thead{display:none}table.stack tr{display:block;padding:8px}table.stack td{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:12px;text-align:left;padding:6px}table.stack td:before{content:attr(data-label);font-weight:bold}}@media print{main{max-width:none;margin:0;padding:0}section,tr{break-inside:avoid}thead{display:table-header-group}.table-wrap{overflow:visible}}
  </style></head><body><main><h1>${title}</h1><p>${h(receipt?.id ?? invoice.id)}</p>${invoiceIdentity(invoice)}<p>Invoice status: ${h(billingLabel(invoice.status))}</p>${invoiceLines(invoice)}${invoiceTotals(invoice)}${payments}${invoiceRefunds(invoice)}${invoice.studio.receiptDetails ? `<p class="details">${h(invoice.studio.receiptDetails)}</p>` : ''}<p>All amounts are in US dollars. An invoice records charges. Payment and refund settlement states are shown separately.</p></main></body></html>`
}

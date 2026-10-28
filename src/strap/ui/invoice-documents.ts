import { money } from './format'
import { billingLabel, invoiceIdentity, invoiceLines, invoiceRefunds, invoiceTime, invoiceTotals, receiptDetails } from './invoice-copy'
import type { InvoiceDocument, InvoiceReceipt } from './invoice-copy'
import { body, emptyLine, field, form, h, hidden, owner, panel, rows, select, textarea } from './shared'

const request = () => hidden('requestId', crypto.randomUUID())
const confirm = (name: string, label: string) => `<label class="check"><input type="checkbox" name="${h(name)}" value="yes" required> ${h(label)}</label>`

function sendDocument(invoice: InvoiceDocument, receipt: InvoiceReceipt | undefined, back: string, staff: boolean) {
  if (!invoice.canSend) return ''
  const identity = hidden('packId', invoice.packId) + (receipt ? hidden('receiptId', receipt.id) : '') + request()
  const fields = staff ? select('channel', 'Member requested this through', [['desk', 'At the desk'], ['phone', 'By phone'], ['inbox', 'In an inbox conversation']], 'desk')
    + confirm('requested', 'The member requested this document at their own email address on file.') : ''
  return `<details class="more"><summary>Email ${receipt ? 'receipt' : 'invoice'}</summary><div class="panel-body">${form(staff ? 'billing.receipt.send.staff' : 'billing.receipt.send', back, identity + fields, staff ? 'Send requested copy' : 'Email my copy', 'quiet')}</div></details>`
}

function refundControls(s: any, invoice: InvoiceDocument, back: string) {
  if (!owner(s) || !invoice.canRefund) return ''
  const lines = invoice.lines.filter(line => line.kind !== 'tax' && line.amountCents > line.refundedCents)
  if (!lines.length) return ''
  return `<details class="more"><summary>Request a line refund</summary><div class="panel-body"><p>Request a Stripe test refund against the original collected payment. Pending or failed refunds do not count as refunded money.</p>`
    + form('billing.line.refund', back, hidden('packId', invoice.packId) + request()
      + select('lineId', 'Invoice line', lines.map(line => [line.id, line.label + ' · ' + money(line.amountCents - line.refundedCents) + ' not refunded']))
      + field('amount', 'Refund amount (USD)', '', 'number', 'required min="0.01" step="0.01" inputmode="decimal"')
      + textarea('reason', 'Reason for refund', '', 'required maxlength="500"')
      + confirm('confirm', 'I approve this exact refund amount and invoice line.'), 'Request test refund', 'quiet') + '</div></details>'
}

function allocationControls(s: any, invoice: InvoiceDocument, back: string) {
  if (!owner(s) || !invoice.canAllocate) return ''
  const payments = rows(s, 'payments').filter(payment => payment.personId === invoice.personId && payment.amountCents > 0 && payment.kind !== 'refund')
  const lines = invoice.lines.filter(line => line.amountCents > line.refundedCents)
  if (!payments.length || !lines.length) return ''
  return `<details class="more"><summary>Allocate a recorded payment</summary><div class="panel-body"><p>Apply an existing payment to an invoice line. No new payment is collected; the available amount is checked when you submit.</p>`
    + form('billing.receipt.allocate', back, hidden('packId', invoice.packId) + request()
      + select('paymentId', 'Recorded payment', payments.map(payment => [payment.id, payment.reference + ' · ' + money(payment.amountCents)]))
      + select('chargeId', 'Invoice line', lines.map(line => [line.id, line.label]))
      + field('amount', 'Amount to apply (USD)', '', 'number', 'required min="0.01" step="0.01" inputmode="decimal"'), 'Allocate payment', 'quiet') + '</div></details>'
}

/** Supplied documents are already authorized; the selected profile adds a person filter. */
export function invoiceDocumentsPanel(s: any, personId?: string, back = '/app/packs', staff = s.actor.role !== 'member') {
  const selected = staff ? personId : s.actor.personId
  const invoices: InvoiceDocument[] = (s.invoiceDocuments?.invoices ?? []).filter((invoice: InvoiceDocument) => !selected || invoice.personId === selected)
  const documents = [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(invoice => {
    const receipts = invoice.receipts.map(receipt => `<section data-payment-receipt="${h(receipt.id)}"><h4>Payment receipt</h4>${receiptDetails(invoice, receipt)}<p><a class="btn-quiet small" download href="/api/strap/receipt.html?id=${encodeURIComponent(receipt.id)}&amp;packId=${encodeURIComponent(invoice.packId)}">Download receipt</a></p>${sendDocument(invoice, receipt, back, staff)}</section>`).join('')
    const reconcile = owner(s) && invoice.canRefund ? invoice.refunds.filter(refund => ['creating', 'pending', 'uncertain'].includes(refund.status)).map(refund => form('billing.refund.reconcile', back, hidden('id', refund.id) + request(), 'Check refund with Stripe', 'quiet')).join('') : ''
    const deliveries = (s.invoiceDocuments?.deliveries ?? []).filter((delivery: any) => delivery.invoiceId === invoice.id)
    const history = deliveries.length ? `<details class="more"><summary>Copy delivery history</summary>${deliveries.map((delivery: any) => `<p>${delivery.receiptId ? 'Receipt' : 'Invoice'} · ${h(billingLabel(delivery.status))} · ${h(invoiceTime(invoice, delivery.createdAt))}${delivery.staffMade ? ' · Requested by staff' : ''}</p>`).join('')}<p class="meta">Provider acceptance does not confirm arrival in the member’s mailbox.</p></details>` : ''
    return `<details class="more" data-invoice-document="${h(invoice.id)}"><summary>${staff ? h(invoice.memberName) + ' · ' : ''}Invoice · ${money(invoice.totalCents)} USD · ${h(billingLabel(invoice.status))} · ${money(invoice.balanceCents)} balance due</summary><div class="panel-body">${invoiceIdentity(invoice)}<p>Invoice ${h(invoice.id)} · ${h(billingLabel(invoice.status))}</p>${invoiceLines(invoice)}${invoiceTotals(invoice)}<p><a class="btn-quiet small" download href="/api/strap/invoice.html?id=${encodeURIComponent(invoice.packId)}">Download invoice</a></p>${sendDocument(invoice, undefined, back, staff)}${receipts || '<p>No payments allocated to this invoice.</p>'}${invoiceRefunds(invoice)}${reconcile}${refundControls(s, invoice, back)}${allocationControls(s, invoice, back)}${history}${invoice.studio.receiptDetails ? `<p class="letter">${h(invoice.studio.receiptDetails)}</p>` : ''}</div></details>`
  }).join('')
  return panel('Invoices and payment receipts', invoices.length ? body(documents) : emptyLine('Invoices appear here after a pack is sold.'), { id: 'invoice-documents', icon: 'report', className: 'history' })
}

import { body, cell, emptyLine, h, panel, statusPill, table } from './shared';

const at = (value: string | null) => value ? `<time datetime="${h(value)}">${h(value)}</time>` : 'Unknown';
const source = (value: string | null) => value ? `<code>${h(value)}</code>` : 'Unavailable';
const review = (url: string, label: string) => `<a href="${h(url)}">${h(label)}</a>`;

export function recoveryDiagnosticsPage(s: any) {
  const d = s.recoveryDiagnostics;
  const connections = [['Billing test connection', d.billing], ['Member email', d.mail]].map(([label, c]: any) => `<tr>${cell('Connection', h(label))}${cell('State', statusPill(c.connectionState) + `<p>${h(c.reason.replace(/_/g, ' '))}</p>`)}${cell('Last review', at(c.reviewedAt) + `<p>${h(c.freshness)}; provider health unknown</p>`)}${cell('Review', review(c.reviewUrl, 'Review connection'))}</tr>`).join('');
  const operations = d.operations.map((r: any) => `<tr>${cell('Source', source(r.id) + `<p>${h(r.type)}</p>` + (r.agreementId ? `<p>Agreement ${source(r.agreementId)}</p>` : '') + (r.setupId ? `<p>Setup ${source(r.setupId)}</p>` : ''))}${cell('Outcome', statusPill(r.status) + `<p>${h(r.code?.replace(/_/g, ' ') ?? 'No recorded error')}${r.httpStatus ? `; HTTP ${h(r.httpStatus)}` : ''}</p><p>Connection ${h(r.connectionState)}</p>`)}${cell('Observed', `Started ${at(r.createdAt)}<p>Finished ${at(r.finishedAt)}</p><p>${h(r.freshness)}</p>`)}${cell('Review', review(r.reviewUrl, r.type === 'connect' ? 'Review billing connection' : 'Review billing agreement'))}</tr>`).join('');
  const exceptions = d.exceptions.map((r: any) => `<tr>${cell('Source', source(r.id) + (r.invoiceId ? `<p>Invoice ${source(r.invoiceId)}</p>` : '') + (r.eventId ? `<p>Event ${source(r.eventId)}</p>` : ''))}${cell('Outcome', statusPill(r.status) + `<p>${h(r.code.replace(/_/g, ' '))}</p><p>Connection ${h(r.connectionState)}</p>`)}${cell('Observed', `First ${at(r.createdAt)}<p>Last ${at(r.observedAt)}</p><p>Resolved ${at(r.resolvedAt)}</p><p>${h(r.freshness)}</p>`)}${cell('Review', review(r.reviewUrl, 'Review payment exception'))}</tr>`).join('');
  const notices = d.notices.map((r: any) => `<tr>${cell('Source', source(r.id) + `<p>${h(r.sourceKind)} ${source(r.sourceId)}</p>`)}${cell('Outcome', statusPill(r.status) + `<p>${h(r.code?.replace(/_/g, ' ') ?? 'No recorded error')}</p>`)}${cell('Observed', `Created ${at(r.createdAt)}<p>Attempted ${at(r.attemptedAt)}</p><p>Finished ${at(r.finishedAt)}</p><p>${h(r.freshness)}</p>`)}${cell('Review', review(r.reviewUrl, 'Review class notices'))}</tr>`).join('');
  const history = (title: string, rows: string, empty: string) => panel(title, rows ? table(['Source','Outcome','Observed','Review'], rows) : body(emptyLine(empty)));
  return `<div class="page single"><div class="page-main recovery-diagnostics"><div class="page-title"><h1>Recovery diagnostics</h1></div>`
    + panel('Read-only recovery review', body(`<p>Opening this page never retries a payment, sends a notice, reconnects a provider or grants authority. Review the existing source before taking a separate action.</p><p>${h(d.observationPolicy)}</p><p>Read at ${at(d.generatedAt)}. An accepted notice is provider acceptance, not confirmed delivery. Unknown outcomes need review before any resend.</p>${review('/app/studio', 'Back to Studio settings')} · ${review('/api/strap/recovery-diagnostics', 'Open diagnostic JSON')}`))
    + panel('Installation connections', table(['Connection','State','Last review','Review'], connections))
    + history('Billing operations', operations, 'No retained billing operations. Provider outcome unknown.')
    + history('Billing exceptions', exceptions, 'No retained billing exceptions. This is not a live provider health check.')
    + history('Notice outcomes', notices, 'No retained notice outcomes. Delivery unknown.')
    + '</div></div>';
}

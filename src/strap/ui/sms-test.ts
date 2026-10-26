import { body, cell, form, h, hidden, panel, table, textarea } from './shared';

export function smsTestPanel(s: any) {
  if (s.actor.role !== 'owner' || !s.smsTest) return '';
  const test = s.smsTest;
  const submissions = test.submissions.map((row: any) => '<tr>'
    + cell('Message', h(row.body))
    + cell('Outcome', h(row.status === 'submitted' ? 'Submitted to Twilio TEST; no handset delivery' : row.status === 'sending' ? 'Submission claimed; outcome unknown' : row.status)
      + (row.providerStatus ? `<small>Provider state: ${h(row.providerStatus)} (test)</small>` : '')
      + (row.errorCode ? `<small>Error: ${h(row.errorCode)}</small>` : ''))
    + cell('Segments and price', `${h(row.segments ?? 'Unknown')} segments<small>${row.price !== null && row.priceUnit ? `Provider price: ${h(row.price)} ${h(row.priceUnit)}` : 'Provider price unavailable'}</small>`)
    + '</tr>').join('');
  const callbacks = test.statuses.map((row: any) => `<li>${h(row.providerStatus)} · synthetic signed status callback${row.errorCode ? ` · ${h(row.errorCode)}` : ''}</li>`)
    .concat(test.inbound.map((row: any) => `<li>Reply callback · ${h(row.body)} · synthetic; no real inbound message</li>`)).join('');
  const controls = !test.configured ? '<p>Twilio TEST credentials are not configured.</p>' : !test.connected
    ? form('sms.test.connect', '/app/studio', hidden('confirm', 'true'), 'Review and connect TEST account')
    : `<p>TEST account connected. Only Twilio’s magic test phone is used.</p>${form('sms.test.send', '/app/studio', hidden('requestId', crypto.randomUUID())
      + textarea('body', 'Test message', 'Strap connection test.', 'required maxlength="1600"'), 'Submit test message')}`;
  return panel('Twilio SMS test', body('<p>Test submissions validate the provider connection without contacting a handset. Twilio TEST does not produce delivery events or replies, and does not prove a registered studio sender.</p>' + controls)
    + `<div class="table-wrap">${table(['Message', 'Outcome', 'Segments and price'], submissions || '<tr><td colspan="3">No test submissions.</td></tr>')}</div>`
    + (callbacks ? body(`<details><summary>Callback checks</summary><p>These signed fixtures test application handling. They are separate from provider-originated delivery evidence.</p><ul>${callbacks}</ul></details>`) : ''), { id: 'sms-test' });
}

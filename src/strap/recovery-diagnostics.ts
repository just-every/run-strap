import type { Bindings } from '../auth.server';
import { connection } from './billing/model';
import { load } from './domain/store';
import { DomainError, humanOwner, list, type Actor } from './domain/types';
import { memberMail } from './domain/notices';
import { memberMailConfigured } from './notice-mail';
import { connected as taxConnection } from './tax/model';
import { testConnected as smsConnected, testIdentity as smsIdentity } from './twilio/config';

const choice = (value: unknown, allowed: string[]) => typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
const reference = (value: unknown) => typeof value === 'string' && /^[\w:.-]{1,200}$/.test(value) ? value : null;
const timestamp = (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 8.64e15 ? new Date(n).toISOString() : null;
};
const codes = ['billing_provider_refused','billing_provider_outcome_unknown','billing_provider_response_invalid',
  'billing_hosted_setup_incomplete','billing_connection_changed','billing_mandate_changed','billing_method_changed',
  'billing_account_mismatch','billing_webhook_invoice_unmatched','billing_webhook_provider_unavailable',
  'billing_webhook_provider_mismatch','billing_webhook_source_mismatch','billing_webhook_event_unsupported',
  'billing_checkout_outcome_unknown','billing_checkout_payment_incomplete','billing_checkout_reconciliation_unavailable',
  'billing_checkout_source_mismatch','billing_native_comparison_mismatch','billing_refund_or_dispute_requires_review',
  'billing_checkout_amount_or_mode_mismatch','billing_payment_intent_mismatch','billing_charge_mismatch','billing_provider_invoice_mismatch',
  'billing_native_payment_mismatch','billing_native_reconciliation_failed',
  'tax_provider_refused','tax_provider_outcome_unknown','tax_provider_evidence_invalid','tax_connection_review_required',
  'tax_owner_authority_changed','tax_test_settings_not_active','tax_active_registration_required',
  'provider_outcome_unknown','transport_uncertain','provider_rejected','provider_rate_limited','provider_uncertain','provider_refused',
  'integration_credential_invalid','integration_credential_required','integration_credential_revoked','invalid_cursor','invalid_limit',
  'location_not_granted','rate_limited','read_only','schema_version_required','scope_not_granted','unsupported_schema_version','wrong_origin'];
// Twilio reports numbered errors; the number is kept, never its prose.
const providerCode = (value: unknown) => typeof value === 'string' && /^\d{1,6}$/.test(value) ? value : typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1e6 ? String(value) : value == null ? null : choice(value, codes);
const smsStatuses = ['queued','sending','sent','delivered','undelivered','failed'];
const httpStatus = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const bySourceTime = (a: {createdAt: string | null; id: string | null}, b: {createdAt: string | null; id: string | null}) =>
  (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || (a.id ?? '').localeCompare(b.id ?? '');

/** A read-only, explicit projection. Provider prose, identifiers, request bodies,
 * credentials, member notes and contact details never enter this response. */
export async function recoveryDiagnostics(env: Bindings, who: Actor) {
  humanOwner(who);
  const loaded = await load(env.DB, who);
  humanOwner(loaded.who);
  const time = Date.now();
  const freshness = (at: string | null) => !at || Date.parse(at) > time ? 'unknown' : time - Date.parse(at) > 86_400_000 ? 'stale' : 'recorded';
  let billingConnection = null, billingReason = 'review_required';
  try { billingConnection = await connection(env); billingReason = 'reviewed_here'; }
  catch (error) {
    if (!(error instanceof DomainError) || !['billing_reconnection_required','stripe_billing_test_not_configured','stripe_billing_live_key_refused'].includes(error.code)) throw error;
    billingReason = error.code === 'stripe_billing_live_key_refused' ? 'configuration_invalid' : 'review_required';
  }
  const review = billingConnection ? list(loaded.state, 'billingConnectionReview').filter(r => r.connectionId === billingConnection.connection_id).at(-1) : null;
  const mail = memberMail(loaded.state), mailConfigured = memberMailConfigured(env);
  let tax = null;
  try { tax = await taxConnection(env, loaded.state); }
  catch (error) {
    if (!(error instanceof DomainError) || !['taxConfig_not_found','tax_connection_review_required','stripe_tax_test_not_configured'].includes(error.code)) throw error;
  }
  const billingSource = (connectionId: unknown) => billingConnection && connectionId === billingConnection.connection_id ? 'current' : 'disconnected';
  const noticeRows = (await env.DB.prepare('SELECT id,source_kind,source_id,status,code,created_at,attempted_at,finished_at FROM st_notice_deliveries ORDER BY created_at DESC,id').all()).results;
  const sms = await smsIdentity(env), smsLive = await smsConnected(env);
  const smsReview = await env.DB.prepare("SELECT connected_at FROM st_sms_connections WHERE id='twilio-test'").first<{connected_at: unknown}>();
  const smsCallbacks = list(loaded.state, 'smsTestStatus');
  // Inbound keys are credentials: their request log never travels in an archive, so a restored studio lists none.
  const keys = (await env.DB.prepare(`SELECT i.id,i.created_at,i.revoked_at,r.at AS last_at,r.status AS last_status,r.code AS last_code,
    (SELECT COUNT(*) FROM st_integration_requests f WHERE f.integration_id=i.id AND f.status>=400) AS refused
    FROM st_integrations i LEFT JOIN st_integration_requests r ON r.seq=(SELECT MAX(seq) FROM st_integration_requests WHERE integration_id=i.id)
    WHERE i.owner_id=? ORDER BY i.created_at DESC,i.id`).bind(who.id).all()).results;
  return {
    generatedAt: new Date(time).toISOString(), readOnly: true,
    observationPolicy: 'Retained observations only. Older than 24 hours is stale. No live provider health check or confirmed delivery is implied.',
    billing: { configured: !!env.STRIPE_BILLING_TEST_KEY && env.RER_DEMO !== '1', connectionState: billingConnection ? 'connected' : 'disconnected', reason: billingReason,
      reviewedAt: timestamp(review?.approvedAt), freshness: freshness(timestamp(review?.approvedAt)), providerHealth: 'unknown', reviewUrl: '/app/studio#payment-connection' },
    mail: { configured: mailConfigured, connectionState: mailConfigured && mail?.origin === env.AUTH_ORIGIN ? 'connected' : 'disconnected',
      reason: !mailConfigured ? 'not_configured' : mail?.origin !== env.AUTH_ORIGIN ? 'review_required' : 'reviewed_here',
      reviewedAt: timestamp(mail?.connectedAt), freshness: freshness(timestamp(mail?.connectedAt)), providerHealth: 'unknown', reviewUrl: '/app/studio#member-mail' },
    tax: { configured: !!env.STRIPE_TAX_TEST_KEY && env.RER_DEMO !== '1', connectionState: tax ? 'connected' : 'disconnected',
      reason: tax ? 'reviewed_here' : 'review_required', reviewedAt: timestamp(tax?.updatedAt), freshness: freshness(timestamp(tax?.updatedAt)),
      providerHealth: 'unknown', reviewUrl: '/app/studio#tax' },
    sms: { configured: !!sms, connectionState: smsLive ? 'connected' : 'disconnected', reason: !sms ? 'not_configured' : smsLive ? 'reviewed_here' : 'review_required',
      reviewedAt: timestamp(smsReview?.connected_at), freshness: freshness(timestamp(smsReview?.connected_at)), providerHealth: 'unknown', reviewUrl: '/app/studio#sms-test' },
    operations: list(loaded.state, 'billingOperation').map(r => ({
      id: reference(r.id), type: choice(r.type, ['connect','setup.start','setup.complete']),
      status: choice(r.status, ['pending','succeeded','failed','uncertain','incomplete']), code: r.errorCode == null ? null : choice(r.errorCode, codes),
      agreementId: reference(r.agreementId), setupId: reference(r.setupId),
      createdAt: timestamp(r.createdAt), finishedAt: timestamp(r.finishedAt), freshness: freshness(timestamp(r.finishedAt ?? r.createdAt)),
      connectionState: billingConnection && r.connectionId === billingConnection.connection_id ? 'current' : 'disconnected',
      httpStatus: httpStatus(r.providerReceipt?.httpStatus),
      reviewUrl: r.type === 'connect' ? '/app/studio#payment-connection' : '/app/packs#billing',
    })).sort(bySourceTime),
    checkouts: list(loaded.state, 'stripeInvoice').map(r => ({
      id: reference(r.id), packId: reference(r.packId), status: choice(r.status, ['creating','open','uncertain','paid','expired']),
      createdAt: timestamp(r.createdAt), observedAt: timestamp(r.reconciledAt ?? r.updatedAt ?? r.createdAt), paidAt: timestamp(r.paidAt),
      freshness: freshness(timestamp(r.reconciledAt ?? r.updatedAt ?? r.createdAt)), connectionState: billingSource(r.connectionId),
      reviewUrl: '/app/packs#payments',
    })).sort(bySourceTime),
    reconciliations: list(loaded.state, 'billingReconciliation').map(r => ({
      id: reference(r.id), invoiceId: reference(r.invoiceId), status: choice(r.status, ['exception','reconciled']),
      code: r.errorCode == null ? null : choice(r.errorCode, codes), createdAt: timestamp(r.at), freshness: freshness(timestamp(r.at)),
      paymentRecorded: typeof r.paymentRecorded === 'boolean' ? r.paymentRecorded : null,
      connectionState: billingSource(r.connectionId), reviewUrl: '/app/packs#payments',
    })).sort(bySourceTime),
    taxOperations: list(loaded.state, 'taxOperation').map(r => ({
      id: reference(r.id), type: choice(r.type, ['config','calculate','confirm','refund']), targetId: reference(r.targetId), resultId: reference(r.resultId),
      status: choice(r.status, ['pending','succeeded','failed','uncertain']), code: r.errorCode == null ? null : choice(r.errorCode, codes),
      createdAt: timestamp(r.createdAt), finishedAt: timestamp(r.finishedAt), freshness: freshness(timestamp(r.finishedAt ?? r.createdAt)),
      connectionState: tax && r.connectionHash === tax.connectionHash ? 'current' : 'disconnected',
      httpStatus: httpStatus(r.providerResponse?.httpStatus), reviewUrl: '/app/studio#tax',
    })).sort(bySourceTime),
    exceptions: list(loaded.state, 'billingException').map(r => ({
      id: reference(r.id), invoiceId: reference(r.invoiceId), eventId: reference(r.eventId),
      status: choice(r.status, ['open','resolved']), code: choice(r.code, codes),
      createdAt: timestamp(r.firstSeenAt ?? r.createdAt), observedAt: timestamp(r.lastSeenAt), resolvedAt: timestamp(r.resolvedAt),
      freshness: freshness(timestamp(r.lastSeenAt)), reviewUrl: '/app/packs#payments',
      connectionState: billingConnection && loaded.state.records.get(r.invoiceId ?? r.eventId)?.data.connectionId === billingConnection.connection_id ? 'current' : 'disconnected',
    })).sort(bySourceTime),
    smsSubmissions: list(loaded.state, 'smsTestSubmission').map(r => {
      const callback = smsCallbacks.filter(c => c.submissionId === r.id).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
      return { id: reference(r.id), status: choice(r.status, ['sending','submitted','rejected','uncertain','delivered','undelivered','failed']),
        providerStatus: r.providerStatus == null ? null : choice(r.providerStatus, smsStatuses), code: providerCode(r.errorCode),
        createdAt: timestamp(r.at), finishedAt: timestamp(r.finishedAt), callbackStatus: callback ? choice(callback.providerStatus, smsStatuses) : null, callbackAt: timestamp(callback?.at),
        freshness: freshness(timestamp(callback?.at ?? r.finishedAt ?? r.at)), connectionState: smsLive && r.configurationHash === sms?.configurationHash ? 'current' : 'disconnected',
        reviewUrl: '/app/studio#sms-test' };
    }).sort(bySourceTime),
    integrations: keys.map(r => ({
      id: reference(r.id), state: r.revoked_at == null ? 'active' : 'revoked', createdAt: timestamp(r.created_at), revokedAt: timestamp(r.revoked_at),
      lastRequestAt: timestamp(r.last_at), lastStatus: httpStatus(r.last_status), lastCode: r.last_code == null ? null : choice(r.last_code, codes),
      refusedRequests: typeof r.refused === 'number' && Number.isInteger(r.refused) ? r.refused : null, freshness: freshness(timestamp(r.last_at)), reviewUrl: '/app/integrations',
    })),
    notices: noticeRows.map(r => ({
      id: reference(r.id), sourceKind: choice(r.source_kind, ['closure','booking','booking_action','confirmation','reminder']), sourceId: reference(r.source_id),
      status: choice(r.status, ['queued','sending','accepted','rejected','rate_limited','uncertain','not_configured','no_address','paused','opted_out']),
      code: r.code == null ? null : choice(r.code, codes), createdAt: timestamp(r.created_at), attemptedAt: timestamp(r.attempted_at), finishedAt: timestamp(r.finished_at),
      freshness: freshness(timestamp(r.finished_at ?? r.attempted_at ?? r.created_at)), reviewUrl: '/app/classes',
    })),
  };
}

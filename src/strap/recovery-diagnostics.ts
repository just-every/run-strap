import type { Bindings } from '../auth.server';
import { connection } from './billing/model';
import { load } from './domain/store';
import { DomainError, humanOwner, list, type Actor } from './domain/types';
import { memberMail } from './domain/notices';
import { memberMailConfigured } from './notice-mail';

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
  'provider_outcome_unknown','transport_uncertain','provider_rejected','provider_rate_limited','provider_uncertain'];
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
  const noticeRows = (await env.DB.prepare('SELECT id,source_kind,source_id,status,code,created_at,attempted_at,finished_at FROM st_notice_deliveries ORDER BY created_at DESC,id').all()).results;
  return {
    generatedAt: new Date(time).toISOString(), readOnly: true,
    observationPolicy: 'Retained observations only. Older than 24 hours is stale. No live provider health check or confirmed delivery is implied.',
    billing: { configured: !!env.STRIPE_BILLING_TEST_KEY && env.RER_DEMO !== '1', connectionState: billingConnection ? 'connected' : 'disconnected', reason: billingReason,
      reviewedAt: timestamp(review?.approvedAt), freshness: freshness(timestamp(review?.approvedAt)), providerHealth: 'unknown', reviewUrl: '/app/studio#payment-connection' },
    mail: { configured: mailConfigured, connectionState: mailConfigured && mail?.origin === env.AUTH_ORIGIN ? 'connected' : 'disconnected',
      reason: !mailConfigured ? 'not_configured' : mail?.origin !== env.AUTH_ORIGIN ? 'review_required' : 'reviewed_here',
      reviewedAt: timestamp(mail?.connectedAt), freshness: freshness(timestamp(mail?.connectedAt)), providerHealth: 'unknown', reviewUrl: '/app/studio#member-mail' },
    operations: list(loaded.state, 'billingOperation').map(r => ({
      id: reference(r.id), type: choice(r.type, ['connect','setup.start','setup.complete']),
      status: choice(r.status, ['pending','succeeded','failed','uncertain','incomplete']), code: r.errorCode == null ? null : choice(r.errorCode, codes),
      agreementId: reference(r.agreementId), setupId: reference(r.setupId),
      createdAt: timestamp(r.createdAt), finishedAt: timestamp(r.finishedAt), freshness: freshness(timestamp(r.finishedAt ?? r.createdAt)),
      connectionState: billingConnection && r.connectionId === billingConnection.connection_id ? 'current' : 'disconnected',
      httpStatus: Number.isInteger(r.providerReceipt?.httpStatus) && r.providerReceipt.httpStatus >= 100 && r.providerReceipt.httpStatus <= 599 ? r.providerReceipt.httpStatus : null,
      reviewUrl: r.type === 'connect' ? '/app/studio#payment-connection' : '/app/packs#billing',
    })).sort(bySourceTime),
    exceptions: list(loaded.state, 'billingException').map(r => ({
      id: reference(r.id), invoiceId: reference(r.invoiceId), eventId: reference(r.eventId),
      status: choice(r.status, ['open','resolved']), code: choice(r.code, codes),
      createdAt: timestamp(r.firstSeenAt ?? r.createdAt), observedAt: timestamp(r.lastSeenAt), resolvedAt: timestamp(r.resolvedAt),
      freshness: freshness(timestamp(r.lastSeenAt)), reviewUrl: '/app/packs#payments',
      connectionState: billingConnection && loaded.state.records.get(r.invoiceId ?? r.eventId)?.data.connectionId === billingConnection.connection_id ? 'current' : 'disconnected',
    })).sort(bySourceTime),
    notices: noticeRows.map(r => ({
      id: reference(r.id), sourceKind: choice(r.source_kind, ['closure','booking','booking_action','confirmation','reminder']), sourceId: reference(r.source_id),
      status: choice(r.status, ['queued','sending','accepted','rejected','rate_limited','uncertain','not_configured','no_address','paused','opted_out']),
      code: r.code == null ? null : choice(r.code, codes), createdAt: timestamp(r.created_at), attemptedAt: timestamp(r.attempted_at), finishedAt: timestamp(r.finished_at),
      freshness: freshness(timestamp(r.finished_at ?? r.attempted_at ?? r.created_at)), reviewUrl: '/app/classes',
    })),
  };
}

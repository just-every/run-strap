import { loadSystem, Transaction } from '../domain/store';
import { DomainError, insist, list, now } from '../domain/types';
import { testIdentity, type TwilioTestBindings } from './config';
import { assertTwilioRequest, verifiedTwilioForm } from './signature';

const provenance = 'synthetic-signed-callback';
const statuses = ['queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed'];
const terminal = ['delivered', 'undelivered', 'failed', 'rejected'];
const xml = () => new Response('<Response></Response>', { headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' } });
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const normalized = (form: URLSearchParams) => new URLSearchParams([...form.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)).toString();

function wholeCount(form: URLSearchParams, field: string): string | null {
  const value = form.get(field);
  if (value === null || value === '') return null;
  insist(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)), 'invalid_sms_' + field, 400);
  return String(Number(value));
}

/** Test credentials do not send callbacks; this door records signed synthetic evidence only. */
export async function smsTestWebhook(request: Request, env: TwilioTestBindings): Promise<Response> {
  try {
    const url = assertTwilioRequest(request, env.AUTH_ORIGIN);
    insist(['/api/strap/sms/test/status', '/api/strap/sms/test/inbound'].includes(url.pathname), 'sms_callback_not_found', 404);
    const identity = await testIdentity(env);
    insist(identity && env.TWILIO_TEST_ACCOUNT_SID && env.TWILIO_TEST_AUTH_TOKEN, 'sms_test_not_configured', 503);
    const form = await verifiedTwilioForm(request, env.AUTH_ORIGIN, env.TWILIO_TEST_AUTH_TOKEN);
    insist(form.get('AccountSid') === env.TWILIO_TEST_ACCOUNT_SID, 'invalid_sms_account', 403);
    const messageId = form.get('MessageSid') ?? '';
    insist(messageId.length > 0 && messageId.length <= 100, 'invalid_sms_message', 400);
    const segments = wholeCount(form, 'NumSegments');
    const connection = await env.DB.prepare("SELECT origin,account_hash,configuration_hash FROM st_sms_connections WHERE id='twilio-test'").first<{ origin: string; account_hash: string; configuration_hash: string }>();
    insist(connection && connection.origin === env.AUTH_ORIGIN && connection.account_hash === identity.accountHash && connection.configuration_hash === identity.configurationHash, 'sms_test_connection_changed', 409);
    const loaded = await loadSystem(env.DB), tx = new Transaction(env.DB, loaded.state, loaded.who);
    // A concurrent disconnect or reconfiguration must also refuse at commit time.
    tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_sms_connections WHERE id='twilio-test' AND origin=? AND account_hash=? AND configuration_hash=?) THEN 1 ELSE 0 END", env.AUTH_ORIGIN, identity.accountHash, identity.configurationHash));
    const basis = await hash(normalized(form));
    if (url.pathname.endsWith('/inbound')) {
      insist(form.get('From') === '+15005550006' && form.get('To') === '+15005550006', 'invalid_sms_destination', 403);
      const body = form.get('Body') ?? '';
      insist(body.length <= 1600, 'invalid_sms_body', 400);
      const id = 'sms-test-inbound:' + await hash(messageId), prior = tx.state.records.get(id);
      if (prior) {
        insist(prior.kind === 'smsTestInbound' && prior.data.basis === basis, 'sms_event_changed', 409);
        return xml();
      }
      tx.put('smsTestInbound', { id, body, segments, basis, configurationHash: identity.configurationHash, mode: 'test', at: now(), provenance });
    } else {
      const providerStatus = form.get('MessageStatus') ?? '';
      insist(statuses.includes(providerStatus), 'invalid_sms_status', 400);
      const errorCode = wholeCount(form, 'ErrorCode');
      const submissions = list(tx.state, 'smsTestSubmission').filter(row => row.providerMessageId === messageId && row.mode === 'test' && row.configurationHash === identity.configurationHash);
      insist(submissions.length === 1, 'sms_submission_not_found', 404);
      const submission = submissions[0], id = 'sms-test-status:' + await hash(submission.id + '\n' + basis);
      if (tx.state.records.has(id)) return xml();
      const at = now();
      tx.put('smsTestStatus', { id, submissionId: submission.id, providerStatus, errorCode, at, provenance, configurationHash: identity.configurationHash });
      const previousStatus = String(submission.providerStatus ?? '');
      const advances = !terminal.includes(String(submission.status)) && !terminal.includes(previousStatus)
        && (terminal.includes(providerStatus) || statuses.indexOf(providerStatus) >= statuses.indexOf(previousStatus));
      tx.put('smsTestSubmission', {
        ...submission,
        ...(advances ? { providerStatus, status: terminal.includes(providerStatus) ? providerStatus : 'submitted', errorCode } : {}),
        ...(segments !== null ? { segments } : {}),
      });
      // Callback Price fields are not a provider resource cost receipt.
    }
    await tx.commit();
    return xml();
  } catch (error) {
    return Response.json({ error: error instanceof DomainError ? error.code : 'sms_callback_failed' }, { status: error instanceof DomainError ? error.status : 500, headers: { 'cache-control': 'no-store' } });
  }
}

import { humanOwner, insist, list, now, text, type Actor } from '../domain/types';
import { load, loadSystem, Transaction } from '../domain/store';
import { digest, magicPhone, testConnected, testIdentity, type TwilioTestBindings } from './config';

const count = (value: unknown) => typeof value === 'string' && /^\d{1,6}$/.test(value) ? value : null;
const price = (value: unknown) => typeof value === 'string' && /^-?\d{1,9}(?:\.\d{1,8})?$/.test(value) ? value : null;

/** A diagnostic uses only explicitly configured TEST credentials and Twilio's
 * magic phone. It selects no member record, live sending identity or real recipient. */
export async function smsTestCommand(env: TwilioTestBindings, who: Actor, name: string, input: Record<string, unknown>) {
  humanOwner(who);
  insist(input && typeof input === 'object' && !Array.isArray(input), 'invalid_input');
  const identity = await testIdentity(env);
  insist(identity, 'twilio_test_not_configured', 409);
  const loaded = await load(env.DB, who), tx = new Transaction(env.DB, loaded.state, loaded.who);
  if (name === 'sms.test.connect') {
    insist(input.confirm === true || input.confirm === 'true', 'test_connection_review_required');
    const at = now();
    tx.sql.push(tx.statement("INSERT INTO st_sms_connections(id,origin,account_hash,configuration_hash,connected_at,connected_by) VALUES('twilio-test',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin,account_hash=excluded.account_hash,configuration_hash=excluded.configuration_hash,connected_at=excluded.connected_at,connected_by=excluded.connected_by",
      env.AUTH_ORIGIN, identity.accountHash, identity.configurationHash, at, who.id));
    const event = { id: 'sms-test-connect:' + crypto.randomUUID(), mode: 'test', origin: env.AUTH_ORIGIN, at, actorId: who.id, actorRole: 'owner' };
    tx.put('smsTestConnectionEvent', event);
    await tx.commit();
    return event;
  }
  insist(name === 'sms.test.send', 'unknown_command', 404);
  insist(await testConnected(env), 'twilio_test_connection_review_required', 409);
  const requestId = text(input.requestId, 'requestId', 100), body = text(input.body, 'body', 1600);
  const id = 'sms-test:' + await digest(who.id + '\n' + requestId);
  const prior = tx.state.records.get(id)?.data;
  if (prior) {
    insist(prior.body === body && prior.configurationHash === identity.configurationHash, 'sms_test_request_changed', 409);
    return prior;
  }
  const reservation = { id, mode: 'test', sourceId: requestId, body, configurationHash: identity.configurationHash,
    at: now(), actorId: who.id, actorRole: 'owner', status: 'sending', providerMessageId: null,
    providerStatus: null, segments: null, price: null, priceUnit: null, errorCode: null };
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_sms_connections WHERE id='twilio-test' AND origin=? AND account_hash=? AND configuration_hash=?) THEN 1 ELSE 0 END", env.AUTH_ORIGIN, identity.accountHash, identity.configurationHash));
  tx.put('smsTestSubmission', reservation);
  await tx.commit();
  // The committed claim is never resent, even after an interrupted or uncertain request.
  let outcome: Record<string, unknown> = { status: 'uncertain', errorCode: 'provider_outcome_unknown' };
  try {
    const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(env.TWILIO_TEST_ACCOUNT_SID!) + '/Messages.json', {
      method: 'POST', headers: { authorization: 'Basic ' + btoa(env.TWILIO_TEST_ACCOUNT_SID + ':' + env.TWILIO_TEST_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: magicPhone, To: magicPhone, Body: body }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as Record<string, unknown>;
    if (response.status === 201 && typeof result.sid === 'string' && result.sid.length > 0 && result.sid.length <= 100) {
      outcome = { status: 'submitted', providerMessageId: result.sid, providerStatus: typeof result.status === 'string' ? result.status.slice(0, 40) : null,
        segments: count(result.num_segments), price: price(result.price), priceUnit: typeof result.price_unit === 'string' && /^[a-z]{3}$/i.test(result.price_unit) ? result.price_unit.toUpperCase() : null, errorCode: null };
    } else if (response.status >= 400 && response.status < 500) {
      outcome = { status: 'rejected', errorCode: typeof result.code === 'number' ? String(result.code) : 'provider_refused' };
    }
  } catch { /* An ambiguous network result must never trigger a second submission. */ }
  const current = await loadSystem(env.DB), finish = new Transaction(env.DB, current.state, current.who);
  const saved = { ...reservation, ...outcome, finishedAt: now() };
  finish.put('smsTestSubmission', saved);
  await finish.commit();
  return saved;
}

export async function smsTestState(env: TwilioTestBindings, who: Actor) {
  if (who.role !== 'owner') return null;
  const loaded = await load(env.DB, who);
  return { configured: !!await testIdentity(env), connected: await testConnected(env),
    submissions: list(loaded.state, 'smsTestSubmission'), inbound: list(loaded.state, 'smsTestInbound'),
    statuses: list(loaded.state, 'smsTestStatus') };
}

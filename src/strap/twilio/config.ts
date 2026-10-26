import type { Bindings } from '../../auth.server';

export interface TwilioTestBindings extends Bindings {
  TWILIO_TEST_ACCOUNT_SID?: string;
  TWILIO_TEST_AUTH_TOKEN?: string;
}
export const magicPhone = '+15005550006';
export const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
export async function testIdentity(env: TwilioTestBindings) {
  if (!env.TWILIO_TEST_ACCOUNT_SID || !env.TWILIO_TEST_AUTH_TOKEN || env.RER_DEMO === '1') return null;
  return { accountHash: await digest(env.TWILIO_TEST_ACCOUNT_SID), configurationHash: await digest(env.TWILIO_TEST_ACCOUNT_SID + '\n' + env.TWILIO_TEST_AUTH_TOKEN) };
}
export async function testConnected(env: TwilioTestBindings) {
  const identity = await testIdentity(env);
  if (!identity) return false;
  return !!await env.DB.prepare("SELECT 1 FROM st_sms_connections WHERE id='twilio-test' AND origin=? AND account_hash=? AND configuration_hash=?")
    .bind(env.AUTH_ORIGIN, identity.accountHash, identity.configurationHash).first();
}

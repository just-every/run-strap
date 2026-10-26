import { insist } from '../domain/types';

/** Validate the public callback envelope before configuration or form processing. */
export function assertTwilioRequest(request: Request, origin: string): URL {
  const url = new URL(request.url);
  const contentType = request.headers.get('content-type') ?? '';
  insist(request.method === 'POST' && url.origin === origin && !url.username && !url.password && !url.hash && !url.href.includes('?')
    && /^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType), 'invalid_sms_callback', 403);
  return url;
}

/** Every form field, including unrecognized ones, participates in Twilio's signature. */
export async function verifiedTwilioForm(request: Request, origin: string, token: string): Promise<URLSearchParams> {
  assertTwilioRequest(request, origin);
  insist(token.length > 0, 'invalid_sms_signature', 403);
  const bytes = await request.arrayBuffer();
  insist(bytes.byteLength <= 10000, 'sms_callback_too_large', 413);
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const keys = [...new Set(form.keys())].sort();
  insist(keys.every(key => form.getAll(key).length === 1), 'invalid_sms_callback', 403);
  const signed = request.url + keys.map(key => key + form.get(key)).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed)))));
  const supplied = request.headers.get('x-twilio-signature') ?? '';
  let different = signature.length ^ supplied.length;
  for (let i = 0; i < signature.length; i++) different |= signature.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
  insist(!different, 'invalid_sms_signature', 403);
  return form;
}

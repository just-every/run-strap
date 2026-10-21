// Test-side second factors: an RFC 6238 authenticator and a software WebAuthn passkey that signs
// like a real authenticator, so enrollment and sign-in go through the public doors only.
import { createHmac, createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function fromBase32(text) {
  let bits = 0, value = 0; const out = []
  for (const char of text.replace(/[\s=]/g, '').toUpperCase()) { value = (value << 5) | ALPHABET.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  return Buffer.from(out)
}
/** The authenticator code for the current 30-second step plus `offset` steps. */
export function totp(secret, offset = 0) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset))
  const mac = createHmac('sha1', fromBase32(secret)).update(counter).digest(), at = mac[19] & 15
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
/** Enrolls an authenticator app for the session in `cookie`; returns its secret and the recovery codes. */
export async function enrollTotp(h, cookie, label = 'Authenticator app') {
  const started = await h.cmd('mfa.totp.start', { label }, cookie)
  const done = await h.cmd('mfa.totp.confirm', { factor: started.factor, code: totp(started.secret) }, cookie)
  return { secret: started.secret, factor: started.factor, recoveryCodes: done.recovery_codes }
}

const b64url = buffer => Buffer.from(buffer).toString('base64url')
const cborText = text => Buffer.concat([Buffer.from([0x60 + text.length]), Buffer.from(text)])
const cborBytes = bytes => Buffer.concat([Buffer.from([bytes.length < 24 ? 0x40 + bytes.length : 0x58, ...(bytes.length < 24 ? [] : [bytes.length])]), bytes])
/** A software ES256 passkey for one relying party. */
export function softwarePasskey(origin) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' }), credentialId = randomBytes(16), rpId = new URL(origin).hostname
  let counter = 0
  const rpHash = createHash('sha256').update(rpId).digest()
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, 'base64url'), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, 'base64url')])
  return {
    credentialId: b64url(credentialId), privateKey,
    registration(challenge) {
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, cose])
      const attestation = Buffer.concat([Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]), cborText('authData'), cborBytes(authData)])
      return { client_data_json: b64url(clientData('webauthn.create', challenge)), attestation_object: b64url(attestation) }
    },
    assertion(challenge, options = {}) {
      const authData = Buffer.concat([options.rpHash ?? rpHash, Buffer.from([0x05]), Buffer.alloc(4)]); authData.writeUInt32BE(options.counter ?? ++counter, 33)
      const data = clientData('webauthn.get', challenge)
      const signature = createSign('sha256').update(Buffer.concat([authData, createHash('sha256').update(data).digest()])).sign(options.key ?? privateKey)
      return { credential_id: b64url(credentialId), client_data_json: b64url(data), authenticator_data: b64url(authData), signature: b64url(signature) }
    },
  }
}

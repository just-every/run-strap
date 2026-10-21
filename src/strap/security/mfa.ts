// SEC-004: second factors. Owners and finance staff enroll an authenticator app (TOTP, its secret
// sealed under MFA_KEY) or a passkey and keep one-time recovery codes; anyone else may opt in. A
// person with a working factor is held at every door until the session presents one; an owner or
// finance user with none is held at the privileged doors (see gate.ts) until they enroll.
import { operatorAuth, type Bindings } from '../../auth.server'
import branding from '../../branding.json'
import { safeReturnTo } from '../../modules/operator-auth/index.mjs'
import { fail } from '../credentials'
import type { Actor } from '../domain'
import { b64url, base32, matchTotp, recoveryCode, recoveryHash, RECOVERY_CODES, seal, unseal } from './crypto'
import { verifyAssertion, verifyRegistration } from './webauthn'

const CHALLENGE_MS = 5 * 60 * 1000
const LOCK_FAILURES = 5, LOCK_MS = 15 * 60 * 1000
const text = (input: Record<string, unknown>, key: string, max: number, optional = false) => {
  const value = typeof input[key] === 'string' ? (input[key] as string).trim() : ''
  if (!value && !optional) fail(`invalid_${key}`)
  if (value.length > max) fail(`invalid_${key}`)
  return value
}

/** Owners (the human, never an agent key) and finance staff must have a second factor for the privileged doors. */
export const covered = (who: Actor) => (who.role === 'owner' && who.isOwner) || who.role === 'finance'

type Factor = { id: string; kind: 'totp' | 'passkey'; label: string; status: string; sealed_secret: string | null; last_step: number; credential_id: string | null; public_key: string | null; sign_count: number; created_at: number }
const binding = (factor: string, operator: string) => `${factor}:${operator}`
const one = <T>(env: Bindings, sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values).first<T>()
const all = async <T>(env: Bindings, sql: string, ...values: unknown[]) => (await env.DB.prepare(sql).bind(...values).all()).results as T[]
const stmt = (env: Bindings, sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values)

/** One append-only audit row, written in the same batch as the change it records. */
export const auditRow = (env: Bindings, who: Actor, action: string, subject: { id: string; email?: string | null }, detail: Record<string, unknown> = {}) =>
  stmt(env, 'INSERT INTO st_security_audit(id,at,actor_id,actor_email,action,subject_id,subject_email,detail) VALUES(?,?,?,?,?,?,?,?)', crypto.randomUUID(), Date.now(), who.id, who.email, action, subject.id, subject.email ?? null, JSON.stringify(detail))
const commit = (env: Bindings, statements: D1PreparedStatement[], who: Actor, action: string, subject: { id: string; email?: string | null }, detail: Record<string, unknown> = {}) =>
  env.DB.batch([...statements, auditRow(env, who, action, subject, detail)])

export const KEY_REASONS: Record<string, string> = {
  mfa_key_missing: 'Your authenticator app was sealed under this installation’s MFA key, and this copy has no MFA key (for example, it was restored without it). Enroll a factor again.',
  mfa_key_changed: 'Your authenticator app was sealed under an MFA key this copy does not hold (for example, it was restored without that key). Enroll a factor again.',
}

/** Where a person stands: which factors still work, and whether this session has presented one. */
export async function standing(env: Bindings, who: Actor) {
  const factors = await all<Factor>(env, "SELECT * FROM st_mfa_factors WHERE operator_id=? AND status='active' ORDER BY created_at", who.id)
  const usable: Factor[] = [], unreadable: Factor[] = []
  for (const factor of factors) (factor.kind === 'passkey' || await unseal(env.MFA_KEY, factor.sealed_secret!, binding(factor.id, who.id)) ? usable : unreadable).push(factor)
  const session = who.sessionId ? await one<{ verified_at: number; method: string }>(env, 'SELECT verified_at,method FROM st_mfa_sessions WHERE session_id=? AND operator_id=?', who.sessionId, who.id) : null
  const reason = !usable.length && unreadable.length ? (env.MFA_KEY ? 'mfa_key_changed' : 'mfa_key_missing') : null
  return { covered: covered(who), usable, unreadable, verifiedAt: session?.verified_at ?? null, method: session?.method ?? null, reason }
}

const requirePerson = (who: Actor) => { if (!who.sessionId || !['owner', 'finance', 'member', 'instructor'].includes(who.role) || (who.role === 'owner' && !who.isOwner)) fail('person_required', 403) }

/** Adding a factor beside a working one needs this session to have presented it. */
async function requireEnrollable(env: Bindings, who: Actor, request: Request) {
  requirePerson(who)
  const { usable, verifiedAt } = await standing(env, who)
  if (usable.length && verifiedAt === null) fail('mfa_required', 403)
  if (!usable.length) await operatorAuth(env).requireStepUp(request, 'credentials:mint')
}
async function requireVerified(env: Bindings, who: Actor) {
  requirePerson(who)
  if ((await standing(env, who)).verifiedAt === null) fail('mfa_required', 403)
}

const markSession = (env: Bindings, who: Actor, method: string) =>
  stmt(env, 'INSERT INTO st_mfa_sessions(session_id,operator_id,verified_at,method) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET verified_at=excluded.verified_at,method=excluded.method', who.sessionId, who.id, Date.now(), method)

async function recoveryStatements(env: Bindings, who: Actor, force = false) {
  const left = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM st_mfa_recovery WHERE operator_id=? AND used_at IS NULL', who.id)
  if (left!.n > 0 && !force) return { codes: null, statements: [] }
  const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode)
  return { codes, statements: [stmt(env, 'DELETE FROM st_mfa_recovery WHERE operator_id=?', who.id), ...await Promise.all(codes.map(async code => stmt(env, 'INSERT INTO st_mfa_recovery(operator_id,code_hash) VALUES(?,?)', who.id, await recoveryHash(code))))] }
}

async function startTotp(env: Bindings, who: Actor, input: Record<string, unknown>, request: Request) {
  await requireEnrollable(env, who, request)
  if (!env.MFA_KEY) fail('mfa_key_missing', 409)
  const secret = crypto.getRandomValues(new Uint8Array(20)), id = crypto.randomUUID()
  await env.DB.batch([
    stmt(env, "DELETE FROM st_mfa_factors WHERE operator_id=? AND kind='totp' AND status='pending'", who.id),
    stmt(env, "INSERT INTO st_mfa_factors(id,operator_id,kind,label,status,sealed_secret,created_at) VALUES(?,?,'totp',?,'pending',?,?)", id, who.id, text(input, 'label', 80, true) || 'Authenticator app', await seal(env.MFA_KEY!, secret, binding(id, who.id)), Date.now()),
  ])
  const encoded = base32(secret), issuer = encodeURIComponent(branding.name)
  return { factor: id, secret: encoded, uri: `otpauth://totp/${issuer}:${encodeURIComponent(who.email)}?secret=${encoded}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` }
}

async function lockedOut(env: Bindings, who: Actor) {
  // Wrong codes since this person last presented a right one, within the window.
  const failures = await one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM st_security_audit WHERE action='mfa.refused' AND subject_id=? AND at>? AND at>COALESCE((SELECT MAX(at) FROM st_security_audit WHERE subject_id=? AND action IN ('mfa.verify','mfa.step_up','mfa.enroll')),0)", who.id, Date.now() - LOCK_MS, who.id)
  if (failures!.n >= LOCK_FAILURES) fail('mfa_locked', 429)
}
async function refuse(env: Bindings, who: Actor, method: string): Promise<never> {
  await commit(env, [], who, 'mfa.refused', who, { method })
  return fail('mfa_code_invalid', 403)
}

async function confirmTotp(env: Bindings, who: Actor, input: Record<string, unknown>, request: Request) {
  await requireEnrollable(env, who, request)
  await lockedOut(env, who)
  const factor = await one<Factor>(env, "SELECT * FROM st_mfa_factors WHERE id=? AND operator_id=? AND kind='totp' AND status='pending'", text(input, 'factor', 100), who.id)
  if (!factor) fail('factor_not_found', 404)
  const secret = await unseal(env.MFA_KEY, factor!.sealed_secret!, binding(factor!.id, who.id))
  if (!secret) fail('mfa_key_changed', 409)
  const step = await matchTotp(secret!, text(input, 'code', 12).replace(/\s/g, ''), Date.now())
  if (step === null) return refuse(env, who, 'totp')
  const recovery = await recoveryStatements(env, who)
  await commit(env, [
    stmt(env, "UPDATE st_mfa_factors SET status='active',last_step=?,confirmed_at=? WHERE id=?", step, Date.now(), factor!.id),
    ...(await standing(env, who)).unreadable.map(old => stmt(env, 'DELETE FROM st_mfa_factors WHERE id=?', old.id)),
    markSession(env, who, 'totp'), ...recovery.statements,
  ], who, 'mfa.enroll', who, { kind: 'totp', factor: factor!.id, label: factor!.label })
  return { factor: factor!.id, kind: 'totp', recovery_codes: recovery.codes }
}

async function presented(env: Bindings, who: Actor, method: string, extra: D1PreparedStatement[]) {
  const before = await one(env, 'SELECT 1 FROM st_mfa_sessions WHERE session_id=?', who.sessionId)
  await commit(env, [...extra, markSession(env, who, method)], who, before ? 'mfa.step_up' : 'mfa.verify', who, { method })
  return { verified: true, method }
}

/** Presents an authenticator code or a one-time recovery code. */
async function verifyFactor(env: Bindings, who: Actor, input: Record<string, unknown>) {
  requirePerson(who)
  await lockedOut(env, who)
  const { usable } = await standing(env, who)
  if (!usable.length) fail('mfa_enrollment_required', 409)
  const code = text(input, 'code', 20).replace(/\s/g, '')
  if (/^\d{6}$/.test(code)) {
    for (const factor of usable.filter(f => f.kind === 'totp')) {
      const step = await matchTotp((await unseal(env.MFA_KEY, factor.sealed_secret!, binding(factor.id, who.id)))!, code, Date.now())
      if (step !== null && step > factor.last_step) return presented(env, who, 'totp', [stmt(env, 'UPDATE st_mfa_factors SET last_step=? WHERE id=? AND last_step<?', step, factor.id, step)])
    }
    return refuse(env, who, 'totp')
  }
  const hash = await recoveryHash(code)
  if (!await one(env, 'SELECT 1 FROM st_mfa_recovery WHERE operator_id=? AND code_hash=? AND used_at IS NULL', who.id, hash)) return refuse(env, who, 'recovery')
  try {
    return await presented(env, who, 'recovery', [
      stmt(env, 'INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_mfa_recovery WHERE operator_id=? AND code_hash=? AND used_at IS NULL) THEN 1 ELSE 0 END', who.id, hash),
      stmt(env, 'UPDATE st_mfa_recovery SET used_at=? WHERE operator_id=? AND code_hash=? AND used_at IS NULL', Date.now(), who.id, hash),
    ])
  } catch (error) { if (/CHECK constraint failed/.test(String(error))) return refuse(env, who, 'recovery'); throw error }
}

const relyingParty = (env: Bindings) => ({ origin: env.AUTH_ORIGIN, rpId: new URL(env.AUTH_ORIGIN).hostname })

async function passkeyOptions(env: Bindings, who: Actor, input: Record<string, unknown>, request: Request) {
  const purpose = text(input, 'purpose', 10)
  if (purpose !== 'register' && purpose !== 'verify') fail('invalid_purpose')
  if (purpose === 'register') await requireEnrollable(env, who, request)
  else { requirePerson(who); await lockedOut(env, who) }
  const passkeys = (await standing(env, who)).usable.filter(factor => factor.kind === 'passkey')
  if (purpose === 'verify' && !passkeys.length) fail('no_passkey', 409)
  const id = crypto.randomUUID(), challenge = b64url(crypto.getRandomValues(new Uint8Array(32)))
  await env.DB.batch([
    stmt(env, 'DELETE FROM st_mfa_challenges WHERE operator_id=? OR expires_at<?', who.id, Date.now()),
    stmt(env, 'INSERT INTO st_mfa_challenges(id,operator_id,session_id,purpose,challenge,expires_at) VALUES(?,?,?,?,?,?)', id, who.id, who.sessionId, purpose, challenge, Date.now() + CHALLENGE_MS),
  ])
  const { rpId } = relyingParty(env), credentials = passkeys.map(factor => ({ type: 'public-key', id: factor.credential_id }))
  return { challenge_id: id, publicKey: purpose === 'register'
    ? { challenge, rp: { id: rpId, name: branding.name }, user: { id: b64url(new TextEncoder().encode(who.id)), name: who.email, displayName: who.email }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], excludeCredentials: credentials, authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, attestation: 'none', timeout: CHALLENGE_MS }
    : { challenge, rpId, allowCredentials: credentials, userVerification: 'required', timeout: CHALLENGE_MS } }
}

async function takeChallenge(env: Bindings, who: Actor, input: Record<string, unknown>, purpose: string) {
  const id = text(input, 'challenge_id', 100)
  const row = await one<{ challenge: string; expires_at: number }>(env, 'DELETE FROM st_mfa_challenges WHERE id=? AND operator_id=? AND session_id=? AND purpose=? RETURNING challenge,expires_at', id, who.id, who.sessionId, purpose)
  if (!row || row.expires_at < Date.now()) fail('passkey_challenge_expired', 409)
  return row!.challenge
}

async function registerPasskey(env: Bindings, who: Actor, input: Record<string, unknown>, request: Request) {
  await requireEnrollable(env, who, request)
  const challenge = await takeChallenge(env, who, input, 'register')
  const registration = await verifyRegistration({ clientDataJSON: text(input, 'client_data_json', 4000), attestationObject: text(input, 'attestation_object', 20000) }, { challenge, ...relyingParty(env) })
  const id = crypto.randomUUID(), recovery = await recoveryStatements(env, who), label = text(input, 'label', 80, true) || 'Passkey'
  try {
    await commit(env, [
      stmt(env, "INSERT INTO st_mfa_factors(id,operator_id,kind,label,status,credential_id,public_key,sign_count,created_at,confirmed_at) VALUES(?,?,'passkey',?,'active',?,?,?,?,?)", id, who.id, label, registration.credentialId, JSON.stringify(registration.publicKey), registration.signCount, Date.now(), Date.now()),
      markSession(env, who, 'passkey'), ...recovery.statements,
    ], who, 'mfa.enroll', who, { kind: 'passkey', factor: id, label })
  } catch (error) { if (/UNIQUE/.test(String(error))) fail('passkey_already_registered', 409); throw error }
  return { factor: id, kind: 'passkey', recovery_codes: recovery.codes }
}

async function verifyPasskey(env: Bindings, who: Actor, input: Record<string, unknown>) {
  requirePerson(who)
  await lockedOut(env, who)
  const challenge = await takeChallenge(env, who, input, 'verify')
  const factor = (await standing(env, who)).usable.find(f => f.kind === 'passkey' && f.credential_id === text(input, 'credential_id', 1500))
  if (!factor) return refuse(env, who, 'passkey')
  let count: number
  try {
    count = await verifyAssertion({ clientDataJSON: text(input, 'client_data_json', 4000), authenticatorData: text(input, 'authenticator_data', 4000), signature: text(input, 'signature', 2000) }, { publicKey: JSON.parse(factor.public_key!), signCount: factor.sign_count }, { challenge, ...relyingParty(env) })
  } catch { return refuse(env, who, 'passkey') }
  return presented(env, who, 'passkey', [stmt(env, 'UPDATE st_mfa_factors SET sign_count=? WHERE id=?', count, factor.id)])
}

/** Ends every session of one operator; the requesting session last, so the request can finish. */
async function endSessions(env: Bindings, request: Request, operatorId: string, current?: string) {
  const auth = operatorAuth(env), sessions = (await auth.listSessions(request, operatorId)).filter(session => session.active)
  for (const session of [...sessions.filter(s => s.id !== current), ...sessions.filter(s => s.id === current)]) await auth.revokeSession(request, session.id)
  return sessions.length
}

/** A person removes one of their own factors from a session that has presented one; every session of theirs ends. */
async function removeFactor(env: Bindings, request: Request, who: Actor, input: Record<string, unknown>) {
  await requireVerified(env, who)
  const factor = await one<Factor>(env, 'SELECT * FROM st_mfa_factors WHERE id=? AND operator_id=?', text(input, 'factor', 100), who.id)
  if (!factor) fail('factor_not_found', 404)
  const others = (await standing(env, who)).usable.filter(f => f.id !== factor!.id)
  const last = !others.length
  if (covered(who) && last) fail('mfa_last_factor_required', 409)
  const fence = covered(who) ? [stmt(env, `INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_mfa_factors WHERE operator_id=? AND status='active' AND id IN (${others.map(() => '?').join(',')})) THEN 1 ELSE 0 END`, who.id, ...others.map(f => f.id))] : []
  try { await commit(env, [...fence,stmt(env, 'DELETE FROM st_mfa_factors WHERE id=?', factor!.id), ...(last ? [stmt(env, 'DELETE FROM st_mfa_recovery WHERE operator_id=?', who.id)] : []), stmt(env, 'DELETE FROM st_mfa_sessions WHERE operator_id=?', who.id)],
    who, 'mfa.remove', who, { kind: factor!.kind, factor: factor!.id, label: factor!.label })
  } catch (error) { if (/CHECK constraint failed/.test(String(error))) fail('mfa_last_factor_required', 409); throw error }
  return { id: factor!.id, removed: true, sessions_ended: await endSessions(env, request, who.id, who.sessionId) }
}

/** Replaces the unused recovery codes with ten new ones, shown once. */
async function renewRecovery(env: Bindings, who: Actor) {
  await requireVerified(env, who)
  if (!(await standing(env, who)).usable.length) fail('mfa_enrollment_required', 409)
  const recovery = await recoveryStatements(env, who, true)
  await commit(env, recovery.statements, who, 'mfa.recovery_renewed', who)
  return { recovery_codes: recovery.codes }
}

/**
 * Another owner resets a person's factors: every factor and recovery code goes, every session of that
 * person ends at once, and they are back at enrollment. An owner cannot reset themselves; with one
 * owner, recovery codes are the only way back in.
 */
async function resetFactors(env: Bindings, request: Request, who: Actor, input: Record<string, unknown>) {
  if (who.role !== 'owner' || !who.isOwner) fail('owner_required', 403)
  await requireVerified(env, who)
  const target = await one<{ id: string; email: string; role: string; status: string }>(env, 'SELECT id,email,role,status FROM oa_operators WHERE id=?', text(input, 'operatorId', 100))
  if (!target) fail('person_not_found', 404)
  if (target!.id === who.id) fail('another_owner_required', 403)
  await operatorAuth(env).requireStepUp(request, 'delete')
  const reason = text(input, 'reason', 300)
  const removed = (await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM st_mfa_factors WHERE operator_id=?', target!.id))!.n
  if (!removed) fail('no_factor_to_reset', 409)
  await commit(env, [stmt(env, 'DELETE FROM st_mfa_factors WHERE operator_id=?', target!.id), stmt(env, 'DELETE FROM st_mfa_recovery WHERE operator_id=?', target!.id), stmt(env, 'DELETE FROM st_mfa_sessions WHERE operator_id=?', target!.id), stmt(env, 'DELETE FROM st_mfa_challenges WHERE operator_id=?', target!.id)],
    who, 'mfa.reset', { id: target!.id, email: target!.email }, { factorsRemoved: removed, targetRole: target!.role, reason })
  return { operatorId: target!.id, factors_removed: removed, sessions_ended: await endSessions(env, request, target!.id) }
}

/** The signed-in person's own standing, for their security page and GET /api/strap/mfa. */
export async function mfaView(env: Bindings, who: Actor) {
  const s = await standing(env, who)
  const recovery = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM st_mfa_recovery WHERE operator_id=? AND used_at IS NULL', who.id)
  const factors = [...s.usable.map(f => ({ ...f, usable: true })), ...s.unreadable.map(f => ({ ...f, usable: false }))].map(f => ({ id: f.id, kind: f.kind, label: f.label, createdAt: f.created_at, usable: f.usable }))
  return { required: s.covered, verified: s.verifiedAt !== null, verifiedAt: s.verifiedAt, method: s.method, reason: s.reason, reasonText: s.reason ? KEY_REASONS[s.reason] : null, totpAvailable: !!env.MFA_KEY, factors, recoveryCodesLeft: recovery!.n }
}

/** Every person's factor count, for the owner's access screen and reset forms. */
export async function factorCounts(env: Bindings) {
  return Object.fromEntries((await all<{ operator_id: string; n: number }>(env, "SELECT operator_id,COUNT(*) AS n FROM st_mfa_factors WHERE status='active' GROUP BY operator_id")).map(row => [row.operator_id, row.n]))
}

/** The security audit as staff-history events, newest facts the owner can filter by command. */
export async function auditEvents(env: Bindings) {
  return (await all<any>(env, 'SELECT * FROM st_security_audit ORDER BY at DESC, id LIMIT 500')).map(row => {
    const detail = JSON.parse(row.detail)
    return { id: row.id, at: new Date(row.at).toISOString(), personId: row.subject_id, actorId: row.actor_id, actorRole: 'owner', command: row.action, action: row.action, right: row.action.startsWith('finance.') || row.action === 'mfa.reset' ? 'access' : 'security', channel: 'app', reason: detail.reason ?? null, before: null, after: { actor: row.actor_email, subject: row.subject_email, ...detail } }
  })
}

const self = { 'mfa.totp.start': startTotp, 'mfa.totp.confirm': confirmTotp, 'mfa.verify': verifyFactor, 'mfa.passkey.options': passkeyOptions, 'mfa.passkey.register': registerPasskey, 'mfa.passkey.verify': verifyPasskey }
/** Commands a held person may still use: enrolling and presenting their own factor. */
export const selfService = [...Object.keys(self), 'mfa.recovery.renew', 'mfa.remove', 'mfa.step-up']

export async function mfaCommand(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  const run = self[name as keyof typeof self]
  if (run) return run(env, who, input, request)
  if (name === 'mfa.step-up') {
    requirePerson(who)
    return operatorAuth(env).requestStepUp(request, { action: input.purpose === 'reset' ? 'delete' : 'credentials:mint', returnTo: '/app/security?returnTo=' + encodeURIComponent(safeReturnTo(input.returnTo, '/app/security')) })
  }
  if (name === 'mfa.recovery.renew') return renewRecovery(env, who)
  if (name === 'mfa.remove') return removeFactor(env, request, who, input)
  if (name === 'mfa.reset') return resetFactors(env, request, who, input)
  return fail('Unknown security command', 404)
}

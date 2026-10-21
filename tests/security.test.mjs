import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { enrollTotp, softwarePasskey, totp } from './mfa-helpers.mjs'

const mail = async (h, email) => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(r => JSON.parse(r.message)).find(m => m.to.includes(email))
const operatorId = async (h, cookie) => (await h.send('/auth/session', undefined, cookie)).value.operator.id
const refused = async (h, name, input, cookie, status, error) => {
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, `${name}: ${JSON.stringify(r.value)}`); if (error) assert.equal(r.value.error, error, name)
  return r
}
const get = async (h, path, cookie, status, error) => {
  const r = await h.send(path, undefined, cookie)
  assert.equal(r.status, status, `${path}: ${r.text.slice(0, 200)}`); if (error) assert.equal(r.value.error, error, path)
  return r
}
async function financeUser(h, name = 'Fiona') {
  const fiona = await h.person(name)
  await h.cmd('finance.grant', { id: fiona.id })
  return fiona
}
const verifyTotp = (h, secret, cookie, offset = 1) => h.cmd('mfa.verify', { code: totp(secret, offset) }, cookie)
async function presentPasskey(h, key, cookie, options) {
  const { challenge_id, publicKey } = await h.cmd('mfa.passkey.options', { purpose: 'verify' }, cookie)
  return h.send('/api/strap/command', { name: 'mfa.passkey.verify', input: { challenge_id, ...key.assertion(publicKey.challenge, options) } }, cookie)
}

test('SEC-004: a finance user is refused the revenue report before enrolling, then signs in with an authenticator app, a passkey and a recovery code (each recovery code works once)', () => run(async h => {
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const fiona = await financeUser(h)
  // Before enrollment: refused at the report, its downloads and its page; nothing else opens for finance either.
  await get(h, '/api/strap/reports/revenue', fiona.cookie, 403, 'mfa_enrollment_required')
  await get(h, '/api/strap/reports/revenue.csv', fiona.cookie, 403, 'mfa_enrollment_required')
  assert.equal((await h.send('/app/revenue', undefined, fiona.cookie)).headers.get('location').startsWith('/app/security?returnTo=%2Fapp%2Frevenue'), true)
  for (const path of ['/api/strap/state', '/api/strap/reports/attendance', '/api/strap/teaching-pay', '/app/people', '/app/integrations']) await get(h, path, fiona.cookie, 403, 'finance_reports_only')
  for (const [name, input] of [['person.save', { name: 'Eve', email: 'eve@studio.example', role: 'member', active: true }], ['booking.cancel', { id: 'x' }], ['integration.create', { label: 'x' }], ['finance.grant', { id: fiona.id }]]) await refused(h, name, input, fiona.cookie, 403, 'finance_reports_only')
  // An authenticator app: enroll (the session is then checked), recovery codes shown once.
  const app = await enrollTotp(h, fiona.cookie)
  assert.equal(app.recoveryCodes.length, 10)
  assert.equal((await get(h, '/api/strap/reports/revenue', fiona.cookie, 200)).value.totals.grossSalesCents, 0)
  assert.equal((await get(h, '/api/strap/reports/revenue.xlsx', fiona.cookie, 200)).status, 200)
  await get(h, '/api/strap/reports/attendance', fiona.cookie, 403, 'finance_reports_only')
  // Signing in again is a new session: held at the factor until one is presented. The same code is never accepted twice.
  const second = await h.signIn(fiona.email)
  await get(h, '/api/strap/reports/revenue', second, 403, 'mfa_required')
  await refused(h, 'mfa.verify', { code: '000000' }, second, 403, 'mfa_code_invalid')
  await verifyTotp(h, app.secret, second)
  await get(h, '/api/strap/reports/revenue', second, 200)
  await refused(h, 'mfa.verify', { code: totp(app.secret, 1) }, await h.signIn(fiona.email), 403, 'mfa_code_invalid')
  // A passkey is added beside it (this session has presented the app) and then signs in on its own.
  const key = softwarePasskey(h.origin)
  const options = await h.cmd('mfa.passkey.options', { purpose: 'register' }, second)
  const added = await h.cmd('mfa.passkey.register', { challenge_id: options.challenge_id, label: 'Laptop', ...key.registration(options.publicKey.challenge) }, second)
  assert.equal(added.recovery_codes, null, 'working recovery codes are kept, not replaced')
  const third = await h.signIn(fiona.email)
  await get(h, '/api/strap/reports/revenue', third, 403, 'mfa_required')
  const other = softwarePasskey(h.origin)
  assert.equal((await presentPasskey(h, key, third, { key: other.privateKey })).status, 403, 'a signature from another key is refused')
  assert.equal((await presentPasskey(h, key, third, { counter: 0, rpHash: Buffer.alloc(32) })).status, 403, 'another relying party is refused')
  assert.equal((await presentPasskey(h, key, third)).status, 200)
  await get(h, '/api/strap/reports/revenue', third, 200)
  assert.equal((await presentPasskey(h, key, third, { counter: 1 })).status, 403, 'a replayed signature counter is refused')
  // A recovery code works once: the second use, from a fresh session, is refused.
  const code = app.recoveryCodes[0], fourth = await h.signIn(fiona.email), fifth = await h.signIn(fiona.email)
  await h.cmd('mfa.verify', { code }, fourth)
  await get(h, '/api/strap/reports/revenue', fourth, 200)
  await refused(h, 'mfa.verify', { code }, fifth, 403, 'mfa_code_invalid')
  await get(h, '/api/strap/reports/revenue', fifth, 403, 'mfa_required')
  assert.equal((await get(h, '/api/strap/mfa', fourth, 200)).value.recoveryCodesLeft, 9)
  // Five wrong codes pause the person: the right one is refused until the pause ends.
  for (let i = 0; i < 4; i++) await refused(h, 'mfa.verify', { code: '111111' }, fifth, 403, 'mfa_code_invalid')
  await refused(h, 'mfa.verify', { code: totp(app.secret, -1) }, fifth, 429, 'mfa_locked')
  // Revoking the grant returns the person to a member identity at once.
  await h.cmd('finance.revoke', { id: fiona.id })
  await get(h, '/api/strap/reports/revenue', fourth, 403, 'owner_required')
}))

test('SEC-004: owners are held at reports, pay, exports, staff access and provider connections until they enroll; another owner resets a factor and the audit shows it', () => run(async h => {
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const first = await operatorId(h, h.owner)
  // A second owner has not enrolled: ordinary work opens, every privileged door is refused and shows no pay or provider data.
  const confirm = async (email, cookie = '') => {
    const m = await mail(h, email), token = new URL(m.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
    return (await h.send('/auth/confirm', { token }, cookie)).cookie
  }
  assert.equal((await h.send('/auth/step-up', { action: 'owner:transfer' }, h.owner)).status, 202)
  await confirm(h.auth.OWNER_EMAIL, h.owner)
  assert.equal((await h.send('/auth/invite', { email: 'second@studio.example', displayName: 'Second Owner', role: 'owner' }, h.owner)).status, 202)
  const second = await confirm('second@studio.example'), secondId = await operatorId(h, second)
  const held = await h.state(second)
  assert.deepEqual([held.teachingPay, held.integrations, held.agentKeys, held.memberMail], [null, [], [], null])
  assert.equal((await get(h, '/api/strap/mfa', second, 200)).value.required, true)
  for (const path of ['/api/strap/staff-history', '/api/strap/staff-history.csv', '/api/strap/reports/revenue', '/api/strap/reports/revenue.csv', '/api/strap/reports/attendance.xlsx', '/api/strap/teaching-pay', '/api/strap/teaching-pay.csv', '/api/strap/exit.json']) await get(h, path, second, 403, 'mfa_enrollment_required')
  for (const page of ['/app/revenue', '/app/teaching-pay', '/app/integrations', '/app/agent']) assert.equal((await h.send(page, undefined, second)).status, 303, page)
  assert.equal((await h.send('/app/people', undefined, second)).status, 200)
  for (const [name, input] of [['agent.create', { label: 'Assistant' }], ['integration.create', { label: 'Door' }], ['kiosk.pair', { label: 'Desk' }], ['pay.rule.save', {}], ['mail.connect', {}], ['finance.grant', { id: 'x' }], ['mfa.reset', { operatorId: first }]]) await refused(h, name, input, second, 403, 'mfa_enrollment_required')
  const enrolled = await enrollTotp(h, second)
  await get(h, '/api/strap/teaching-pay', second, 200)
  // The enrolling owner resets nobody's factors but another owner's: never their own.
  await refused(h, 'mfa.reset', { operatorId: secondId }, second, 403, 'another_owner_required')
  const fresh = await h.signIn(h.auth.OWNER_EMAIL)
  await refused(h, 'mfa.reset', { operatorId: secondId }, fresh, 403, 'mfa_required')
  const reset = await h.cmd('mfa.reset', { operatorId: secondId, reason: 'Lost phone' })
  assert.equal(reset.factors_removed, 1)
  assert.equal((await h.send('/api/strap/state', undefined, second)).status, 401, 'the reset person is signed out everywhere')
  const again = await h.signIn('second@studio.example')
  await get(h, '/api/strap/teaching-pay', again, 403, 'mfa_enrollment_required')
  await refused(h, 'mfa.verify', { code: enrolled.recoveryCodes[0] }, again, 409, 'mfa_enrollment_required')
  // The audit record: who reset whom, when and why; filterable, exportable, owner only.
  const audit = (await get(h, '/api/strap/staff-history?auditCommand=mfa.reset', h.owner, 200)).value.rows
  assert.equal(audit.length, 1)
  assert.deepEqual([audit[0].command, audit[0].actorId, audit[0].personId, audit[0].reason, audit[0].after.actor, audit[0].after.subject, audit[0].after.factorsRemoved], ['mfa.reset', first, secondId, 'Lost phone', h.auth.OWNER_EMAIL, 'second@studio.example', 1])
  assert.match((await get(h, '/api/strap/staff-history.csv?auditCommand=mfa.reset', h.owner, 200)).text, /mfa\.reset/)
  assert.equal((await get(h, '/api/strap/staff-history?auditCommand=mfa.enroll', h.owner, 200)).value.rows.length >= 2, true, 'enrollments are audited too')
  const ana = await h.person('Ana')
  await get(h, '/api/strap/staff-history', ana.cookie, 403)
}))

test('SEC-004: a member opts in, and every later session is held at every door until a factor is presented; with no MFA key a passkey still enrolls', () => run(async h => {
  const ana = await h.person('Ana')
  assert.equal((await get(h, '/api/strap/mfa', ana.cookie, 200)).value.required, false)
  const app = await enrollTotp(h, ana.cookie)
  const next = await h.signIn(ana.email)
  await get(h, '/api/strap/state', next, 403, 'mfa_required')
  await refused(h, 'booking.cancel', { id: 'x' }, next, 403, 'mfa_required')
  await verifyTotp(h, app.secret, next)
  await get(h, '/api/strap/state', next, 200)
  // Removing the only factor needs a checked session and ends every session of the person.
  await refused(h, 'mfa.remove', { factor: app.factor }, await h.signIn(ana.email), 403, 'mfa_required')
  assert.equal((await h.cmd('mfa.remove', { factor: app.factor }, next)).removed, true)
  assert.equal((await h.send('/api/strap/state', undefined, ana.cookie)).status, 401)
  // The owner's own authenticator becomes unreadable when the key changes: they are back at enrollment with the reason.
  await h.db.prepare("UPDATE st_mfa_factors SET sealed_secret='v1.AAAA.AAAA' WHERE kind='totp'").run()
  const view = (await get(h, '/api/strap/mfa', h.owner, 200)).value
  assert.equal(view.reason, 'mfa_key_changed'); assert.match(view.reasonText, /enroll a factor again/i)
  await get(h, '/api/strap/teaching-pay', h.owner, 403, 'mfa_enrollment_required')
}))

test('SEC-004: without an MFA key authenticator apps are refused and a passkey alone opens the privileged doors', () => run(async h => {
  await refused(h, 'mfa.totp.start', {}, h.owner, 409, 'mfa_key_missing')
  await get(h, '/api/strap/teaching-pay', h.owner, 403, 'mfa_enrollment_required')
  const key = softwarePasskey(h.origin), options = await h.cmd('mfa.passkey.options', { purpose: 'register' })
  const added = await h.cmd('mfa.passkey.register', { challenge_id: options.challenge_id, ...key.registration(options.publicKey.challenge) })
  assert.equal(added.recovery_codes.length, 10)
  await get(h, '/api/strap/teaching-pay', h.owner, 200)
  await refused(h, 'mfa.passkey.register', { challenge_id: options.challenge_id, ...key.registration(options.publicKey.challenge) }, h.owner, 409, 'passkey_challenge_expired')
}, { mfa: false, auth: { MFA_KEY: '' } }))

test('SEC-004: the security screens work in a real browser with a passkey at 1440 and 390', () => run(async h => {
  if (!process.env.STRAP_PROOF_DIR && !process.env.CI) return
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const finance = {}, member = {}
  for (const width of [1440, 390]) {
    finance[width] = await financeUser(h, 'Fiona' + width); member[width] = await h.person('Mara' + width)
  }
  await (await import('./security-browser.mjs')).securityBrowser(h, { finance, member, nextSession: person => h.signIn(person.email) })
}, { hostname: 'localhost' }))

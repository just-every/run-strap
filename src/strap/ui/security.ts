// Security (SEC-004): a second factor for the signed-in person, and the owner's access controls.
// Owners and finance staff must enroll before the privileged doors open; members and instructors may opt in.
import { when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, panel, result, rows, select, table } from './shared'

const holdText: Record<string, string> = {
  mfa_enrollment_required: 'Reports, pay, exports, staff access and provider connections open once you add a second factor.',
  mfa_required: 'Enter a code from your authenticator app, use a passkey or a recovery code to continue.',
}
const codes = (list: string[]) => panel('Save your recovery codes', body(`<p>Each code works once if you lose your authenticator app or passkey. They are shown only now. Store them somewhere private.</p><ul class="recovery">${list.map(code => `<li><code>${h(code)}</code></li>`).join('')}</ul>`), { icon: 'key' })

function verify(m: any, query: URLSearchParams) {
  const passkey = m.factors.some((f: any) => f.kind === 'passkey' && f.usable)
  return panel('Confirm it is you', body(`<p>${h(holdText.mfa_required)}</p>`
    + form('mfa.verify', query.get('returnTo') ?? '/app/security', field('code', 'Authenticator code or recovery code', '', 'text', 'required autocomplete="one-time-code" inputmode="text" maxlength="20"'), 'Continue')
    + (passkey ? `<p><button class="btn quiet" type="button" data-door="/api/strap/command" data-passkey="verify" data-return="${h(query.get('returnTo') ?? '/app/security')}">Use a passkey</button></p>` : '')), { icon: 'key' })
}

function enroll(m: any, notice: any, query: URLSearchParams) {
  const started = result(notice)?.secret ? result(notice) : null
  const totp = started
    ? body(`<p>Add this key to your authenticator app as a time-based, six-digit account, then type the code it shows.</p><div class="checkin-code"><p class="meta"><code>${h(started.secret)}</code></p></div>`
      + form('mfa.totp.confirm', query.get('returnTo') ?? '/app/security', hidden('factor', started.factor) + field('code', 'Code from the app', '', 'text', 'required autocomplete="one-time-code" inputmode="numeric" maxlength="12"'), 'Turn on'))
    : body(m.totpAvailable
      ? form('mfa.totp.start', query.get('returnTo') ?? '/app/security', field('label', 'Name', 'Authenticator app', 'text', 'maxlength="80"'), 'Set up an authenticator app', 'quiet')
      : '<p class="notice">Authenticator apps need this installation’s MFA key, which is not set. A passkey works without it.</p>')
  const passkey = body(`<p>Use this device’s fingerprint, face or screen lock, or a security key.</p><p><button class="btn" type="button" data-door="/api/strap/command" data-passkey="register" data-return="${h(query.get('returnTo') ?? '/app/security')}">Add a passkey</button></p><p class="notice" role="alert" data-passkey-error hidden></p>`)
  return panel('Authenticator app', totp, { icon: 'key' }) + panel('Passkey', passkey, { icon: 'key' })
}

function factors(s: any, m: any) {
  const list = m.factors.map((f: any) => `<tr>${cell('Factor', `<strong>${h(f.label)}</strong>${f.usable ? '' : ' <small>Unreadable: enroll again</small>'}`)}${cell('Kind', f.kind === 'totp' ? 'Authenticator app' : 'Passkey')}${cell('Added', when(s, new Date(f.createdAt).toISOString()))}${cell('', m.verified ? form('mfa.remove', '/app/security', hidden('factor', f.id), 'Remove', 'quiet', 'small') : '')}</tr>`).join('')
  const renew = m.factors.length && m.verified ? `<p>${m.recoveryCodesLeft} recovery ${m.recoveryCodesLeft === 1 ? 'code' : 'codes'} left. ${form('mfa.recovery.renew', '/app/security', '', 'New recovery codes', 'quiet', 'small')}</p>` : ''
  return panel('Your second factors', body(m.factors.length ? `<div class="table-wrap">${table(['Factor', 'Kind', 'Added', ''], list)}</div>${renew}` : emptyLine('None yet.')), { icon: 'key' })
}

function people(s: any) {
  const a = s.access, operators = a.operators as any[], finance = new Set((a.finance as any[]).map(f => f.personId))
  const resets = operators.map(o => `<tr>${cell('Person', `<strong>${h(o.name || o.email)}</strong><small>${h(o.email)}</small>`)}${cell('Role', h(o.role))}${cell('Factors', String(o.factors))}${cell('', o.id !== s.actor.id && o.factors ? form('mfa.reset', '/app/security', hidden('operatorId', o.id) + field('reason', 'Reason', '', 'text', 'maxlength="300" placeholder="Lost phone"'), 'Reset factors', 'quiet', 'small') : '')}</tr>`).join('')
  const members = rows(s, 'people').filter(p => p.active && p.role === 'member' && p.email)
  const grants = rows(s, 'people').filter(p => finance.has(p.id)).map(p => `<tr>${cell('Person', `<strong>${h(p.name)}</strong><small>${h(p.email)}</small>`)}${cell('', form('finance.revoke', '/app/security', hidden('id', p.id), 'Remove finance access', 'quiet', 'small'))}</tr>`).join('')
  return panel('Who can sign in', body(`<p>Another owner resets a person’s second factors; you cannot reset your own. Their sessions end at once and they enroll again. Every reset appears in the staff history as <code>mfa.reset</code>.</p><div class="table-wrap">${table(['Person', 'Role', 'Factors', ''], resets)}</div>`), { icon: 'users' })
    + panel('Finance users', body(`<p>A finance user opens the revenue and collections report and its downloads, behind a second factor, and nothing else. Invite the person from People first.</p>${grants ? `<div class="table-wrap">${table(['Person', ''], grants)}</div>` : emptyLine('No finance users.')}`
      + form('finance.grant', '/app/security', select('id', 'Person', [['', 'Choose a member with an email'], ...members.filter(p => !finance.has(p.id)).map(p => [p.id, `${p.name} (${p.email})`] as [string, string])], '', 'required'), 'Make finance user')), { icon: 'report' })
}

export function securityPage(s: any, query: URLSearchParams, notice: any) {
  const m = s.mfa, recovery = result(notice)?.recovery_codes, hold = query.get('hold') ?? ''
  const held = m.factors.some((f: any) => f.usable) && !m.verified
  const intro = held ? '' : `<p class="lede">${m.required ? 'Your role needs a second factor before reports, pay, exports, staff access and provider connections open.' : 'Add a second factor to protect your account. You will be asked for it at each new sign-in.'}${hold && holdText[hold] ? ` ${h(holdText[hold])}` : ''}</p>`
  const reason = m.reasonText ? `<div class="notice" role="alert">${h(m.reasonText)}</div>` : ''
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Security</h1></div>${intro}${reason}${recovery ? codes(recovery) : ''}`
    + (held ? verify(m, query) : enroll(m, notice, query) + factors(s, m) + (s.access ? people(s) : ''))
    + `</div></div><script src="/brand/app/security.js" defer></script>`
}

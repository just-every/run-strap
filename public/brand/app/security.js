// Passkey enrollment and sign-in (SEC-004). Plain browser WebAuthn: the server issues the challenge
// and verifies the result; nothing here decides anything.
const bytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0))
const text = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const post = async (button, name, input) => {
  const response = await fetch(button.dataset.door, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, input }) })
  const value = await response.json()
  if (!response.ok) throw new Error((value.error || 'Could not complete this step').replace(/_/g, ' '))
  return value.result ?? value
}
const credentials = list => (list || []).map(item => ({ ...item, id: bytes(item.id) }))

async function register(button) {
  const { challenge_id, publicKey } = await post(button, 'mfa.passkey.options', { purpose: 'register' })
  const created = await navigator.credentials.create({ publicKey: { ...publicKey, challenge: bytes(publicKey.challenge), user: { ...publicKey.user, id: bytes(publicKey.user.id) }, excludeCredentials: credentials(publicKey.excludeCredentials) } })
  const done = await post(button, 'mfa.passkey.register', { challenge_id, client_data_json: text(created.response.clientDataJSON), attestation_object: text(created.response.attestationObject) })
  const list = (done.recovery_codes || []).map(code => `<li><code>${code}</code></li>`).join('')
  const panel = document.createElement('section')
  panel.className = 'panel'
  panel.innerHTML = `<div class="panel-head"><h2>Passkey added</h2></div><div class="panel-body"><p>Each recovery code works once if you lose your passkey. They are shown only now. Store them somewhere private.</p><ul class="recovery">${list}</ul><p><a class="btn" href="${button.dataset.return}">Continue</a></p></div>`
  button.closest('.page-main').prepend(panel)
  button.disabled = true
}

async function verify(button) {
  const { challenge_id, publicKey } = await post(button, 'mfa.passkey.options', { purpose: 'verify' })
  const got = await navigator.credentials.get({ publicKey: { ...publicKey, challenge: bytes(publicKey.challenge), allowCredentials: credentials(publicKey.allowCredentials) } })
  await post(button, 'mfa.passkey.verify', { challenge_id, credential_id: text(got.rawId), client_data_json: text(got.response.clientDataJSON), authenticator_data: text(got.response.authenticatorData), signature: text(got.response.signature) })
  location.assign(button.dataset.return)
}

for (const button of document.querySelectorAll('[data-passkey]')) button.addEventListener('click', async () => {
  const error = document.querySelector('[data-passkey-error]')
  if (error) error.hidden = true
  try { await (button.dataset.passkey === 'register' ? register(button) : verify(button)) }
  catch (failure) {
    const target = error ?? Object.assign(document.createElement('p'), { className: 'notice', role: 'alert' })
    target.textContent = failure.message; target.hidden = false
    if (!error) button.after(target)
  }
})

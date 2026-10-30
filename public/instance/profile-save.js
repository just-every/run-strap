// Keep interrupted choices only in this page's memory. No profile data goes to
// browser storage, and only a fresh, authorized server read can confirm a save.
const notice = document.querySelector('[data-app-notice]')
if (notice) notice.focus()
for (const form of document.querySelectorAll('form[data-profile-save]')) {
  const status = form.querySelector('[data-save-status]')
  const submit = form.querySelector('button[type=submit]')
  const originalLabel = submit.textContent
  const fields = [...form.querySelectorAll('input:not([type=hidden]), select, textarea')]
  let pending = null, busy = false, changed = false
  const say = (message, error = false) => {
    status.setAttribute('role', error ? 'alert' : 'status')
    status.setAttribute('aria-live', error ? 'assertive' : 'polite')
    status.className = error ? 'notice error' : 'notice'
    status.textContent = message
    status.focus()
  }
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (busy) return
    busy = true
    document.querySelector('[data-app-notice]')?.remove()
    pending ??= new URLSearchParams(new FormData(form))
    for (const field of fields) field.disabled = true
    submit.disabled = true
    form.setAttribute('aria-busy', 'true')
    say('Saving profile. Keep this page open until the result is checked.')
    const action = new URL(form.action)
    let rejection = null
    try {
      const response = await fetch(action, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: pending, signal: AbortSignal.timeout(15000) })
      if (!response.ok && response.status < 500) rejection = (await response.json()).error ?? 'Save refused'
    } catch { /* A failed response can follow a committed save. Read it back. */ }
    const query = new URLSearchParams({ command: action.searchParams.get('name'), requestId: pending.get('requestId') })
    if (pending.has('personId')) query.set('personId', pending.get('personId'))
    try {
      const response = await fetch('/api/strap/profile-save?' + query, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('Save verification unavailable')
      const receipt = await response.json()
      if (receipt.status === 'saved') {
        const target = new URL(action.searchParams.get('returnTo'), location.origin)
        target.searchParams.set('profileSave', pending.get('requestId'))
        location.assign(target)
        return
      }
      if (receipt.status === 'changed') {
        changed = true
        say('The studio profile changed after this save. Your choices are kept here. Reload the current profile before making another change.', true)
        submit.disabled = true
        return
      }
      if (rejection) {
        const messages = { invalid_phone: 'Enter a complete US mobile phone number.', invalid_emergencyPhone: 'Enter a complete US contact phone number.', emergency_contact_needs_name_and_phone: 'Enter both an emergency contact name and phone number.', profile_changed: 'The profile changed. Reload the current profile before saving your choices.', profile_unchanged: 'These details already match the studio record.' }
        say(messages[rejection] ?? rejection.replaceAll('_', ' '), true)
        pending = null
        for (const field of fields) field.disabled = false
        submit.textContent = originalLabel
      } else {
        say('Save not confirmed. Your choices are kept. Retry the same save to check again.', true)
        submit.textContent = 'Retry same save'
      }
    } catch {
      say('Save not confirmed. Your choices are kept. Retry the same save when your connection returns.', true)
      submit.textContent = 'Retry same save'
    } finally {
      busy = false
      form.removeAttribute('aria-busy')
      if (!changed && (submit.textContent !== originalLabel || pending === null)) submit.disabled = false
    }
  })
}

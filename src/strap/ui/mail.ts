import { empty, entry, h, panel, rows, stamp } from './shared'

export function mail(state: any) {
  return '<h1>Local mail</h1><p>Development messages stay in this installation. No email is sent externally. Invitation links are credentials: open them only in the intended person’s local browser profile.</p>' + panel('Development outbox', rows(state, 'developmentMail').map(message => {
    const match = String(message.text).match(/https?:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)
    const link = match ? new URL(match[0]) : null
    const safe = link && ['127.0.0.1', 'localhost', '[::1]'].includes(link.hostname)
    return entry(message.subject, `<p>To: ${h(Array.isArray(message.to) ? message.to.join(', ') : message.to)}<br>${stamp(message.createdAt)}</p><pre class="mail-message">${h(message.text)}</pre>${safe ? `<a class="mail-link" href="${h(link.href)}">Open sign-in or invitation</a>` : ''}`)
  }).join('') || empty('No local sign-in messages yet. Invite a person from People.'))
}

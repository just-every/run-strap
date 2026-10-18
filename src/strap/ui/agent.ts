// Agent access: keys that let an assistant read the studio and prepare drafts.
// The signed-in owner approves every exact draft; a key never can.
import { when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, panel, result, rows, statusPill, table } from './shared'

export function agentPage(s: any, notice: any) {
  const created = result(notice)
  const token = created?.token ? panel('Save your agent key', body(`<p>This key is shown once. Store it somewhere private before you leave this page. It lets your assistant read the studio and prepare drafts; approval stays with you.</p><p class="token">${h(created.token)}</p><p class="meta">Expires ${when(s, created.expiresAt)}</p>`), { icon: 'key' }) : ''
  const keys = rows(s, 'agentKeys')
  const state = (k: any) => k.revokedAt ? 'revoked' : Number(k.expiresAt) <= Date.now() ? 'expired' : 'active'
  const list = keys.length ? `<div class="table-wrap">${table(['Label', 'Created', 'Expires', 'Status', ''], keys.map(k => `<tr>${cell('Label', `<strong>${h(k.label)}</strong>`)}${cell('Created', when(s, k.createdAt))}${cell('Expires', when(s, k.expiresAt))}${cell('Status', statusPill(state(k)))}${cell('', !k.revokedAt ? form('agent.revoke', '/app/agent', hidden('id', k.id), 'Revoke', 'quiet', 'small') : '', 'right')}</tr>`).join(''))}</div>` : emptyLine('No agent keys yet. Create one to connect your assistant.')
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Agent access</h1></div><p class="lede">Your agent reads the studio and prepares class weeks, packs and balance reminders. Each draft waits in Pending approvals until you approve its exact contents.</p>${token}`
    + panel('Agent keys', list, { icon: 'key' })
    + panel('How your agent connects', body('<p>Read the studio with <code>GET /api/strap/agent/context</code>. Send preparations to <code>POST /api/strap/agent/command</code> with the key as a Bearer token and a JSON body of <code>name</code> and <code>input</code>.</p><p>Allowed: <code>classes.prepare</code>, <code>pack.prepare</code>, <code>reminder.prepare</code>.</p><p><a href="/api/strap/commands">Open the command catalogue</a> · <a href="https://github.com/just-every/run-strap/blob/main/docs/AGENT-COMMANDS.md">Read the field guide</a></p>'), { icon: 'report' })
    + `</div><aside class="rail">${panel('Create an agent key', body(form('agent.create', '/app/agent', field('label', 'Key label', '', 'text', 'required maxlength="80" placeholder="Studio assistant"'), 'Create agent key')), { icon: 'plus' })}</aside></div>`
}

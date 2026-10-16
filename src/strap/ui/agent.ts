import { empty, field, form, h, hidden, matPanel, panel, result, row, rows, stamp, status } from './shared'

export function agent(s: any, notice: any) {
 const created = result(notice)
 const token = created?.token ? panel('Save your agent credential', `<p class="meta">This token is shown once. Store it securely before leaving this page. It authorizes reading studio state and preparing drafts; approval remains with the human owner.</p><label>Agent token<input type="text" readonly value="${h(created.token)}" autocomplete="off" spellcheck="false"></label><p class="meta">Expires ${stamp(created.expiresAt)}</p>`) : ''
 const keys = rows(s, 'agentKeys').map(k => row({
  title: k.label,
  meta: `${status(k.revokedAt ? 'Revoked' : Number(k.expiresAt) <= Date.now() ? 'Expired' : 'Active')}<span>Created ${stamp(k.createdAt)}<br>Expires ${stamp(k.expiresAt)}<br>ID: ${h(k.id)}</span>`,
  actions: !k.revokedAt ? form('agent.revoke', '/app/agent', hidden('id', k.id), 'Revoke agent access', 'secondary') : '',
 })).join('')
 return `<h1>Agent access</h1><p class="lede">Agents can read studio state and prepare class weeks, packs and reminders. The signed-in owner reviews and approves each exact draft.</p>${token}${matPanel('Agent keys', keys || empty('No agent keys yet. Create one to connect your assistant.'))}<div class="grid">${panel('Create an agent key', form('agent.create', '/app/agent', field('label', 'Key label', '', 'text', 'required maxlength="80"'), 'Create agent key'))}${panel('Command API', '<p><a href="/api/strap/commands">Open the command catalogue</a> · <a href="https://github.com/just-every/run-strap/blob/main/docs/AGENT-COMMANDS.md">Read field documentation</a></p><p class="meta">Read state with <code>GET /api/strap/agent/context</code>. Submit preparations to <code>POST /api/strap/agent/command</code> using a Bearer token and a JSON body containing <code>name</code> and <code>input</code>.</p><p class="meta">Allowed preparations: <code>classes.prepare</code>, <code>pack.prepare</code>, <code>reminder.prepare</code>.</p>')}</div>`
}

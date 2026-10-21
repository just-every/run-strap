// Integrations (API-002): read-only keys another application uses to read class rosters.
// The owner creates, rotates and revokes them, sets their event subscriptions and reads
// each key's usage and failures. Strap stores only hashes of the secrets.
import { scopeCatalogue } from '../integrations'
import { rateLimit, schemaVersions } from '../integration-api'
import { when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, panel, result, rows, select, statusPill, table } from './shared'

const check = (name: string, label: string, checked: boolean) => `<label class="check"><input type="checkbox" name="${h(name)}" value="true"${checked ? ' checked' : ''}><span>${label}</span></label>`
const group = (label: string, html: string) => `<div class="field" role="group" aria-label="${h(label)}"><span>${h(label)}</span>${html}</div>`
const permitted = (scopes: string[]) => [...new Set(scopes.flatMap(scope => [...(scopeCatalogue[scope as keyof typeof scopeCatalogue]?.events ?? [])]))]
const eventChoices = (events: string[], chosen: string[]) => group('Event subscriptions', events.map(event => check(`ev_${event}`, `<code>${h(event)}</code>`, chosen.includes(event))).join('') + '<p class="meta">Recorded only: Strap does not deliver events yet.</p>')

function keyRow(s: any, key: any, location: string) {
  const live = !key.revokedAt, events = key.events.map((e: any) => e.name)
  const subscriptions = events.length ? events.map((e: string) => `<code>${h(e)}</code>`).join(', ') + ' <span class="meta">· not delivered</span>' : '<span class="meta">None</span>'
  const actions = live ? form('integration.rotate', '/app/integrations', hidden('id', key.id), 'Rotate secret', 'quiet', 'small') + form('integration.revoke', '/app/integrations', hidden('id', key.id), 'Revoke', 'quiet', 'small') : ''
  const log = key.requests.length
    ? `<div class="table-wrap">${table(['Time', 'Request', 'Status', 'Refusal'], key.requests.map((r: any) => `<tr>${cell('Time', when(s, r.at))}${cell('Request', `<code>${h(r.method)} ${h(r.route)}</code>`)}${cell('Status', h(r.status))}${cell('Refusal', r.code ? h(String(r.code).replace(/_/g, ' ')) : '—')}</tr>`).join(''))}</div>`
    : emptyLine('No requests yet.')
  const subscribe = live ? `<details class="more"><summary>Change event subscriptions</summary><div class="panel-body">${form('integration.events', '/app/integrations', hidden('id', key.id) + eventChoices(permitted(key.scopes), events), 'Save subscriptions')}</div></details>` : ''
  return `<tr>${cell('Label', `<strong>${h(key.label)}</strong>`)}${cell('Scope', key.scopes.map((scope: string) => `<code>${h(scope)}</code>`).join(', '))}${cell('Location', h(location))}${cell('Events', subscriptions)}${cell('Last used', when(s, key.lastUsedAt))}${cell('Status', statusPill(live ? 'active' : 'revoked'))}${cell('', actions, 'right')}</tr>`
    + `<tr class="cancel-row"><td colspan="7"><details class="more"><summary>Usage and failures for ${h(key.label)} (${key.requests.length} of the last 100)</summary><div class="panel-body">${log}</div></details>${subscribe}</td></tr>`
}

export function integrationsPage(s: any, notice: any) {
  const created = result(notice), location = s.studio?.location ?? 'Your studio'
  const secret = created?.token ? panel('Save your integration secret', body(`<p>This secret for <strong>${h(created.label)}</strong> is shown once. Store it in the other application's secret settings before you leave this page. Strap keeps only a hash, and any earlier secret for this key has stopped working.</p><p class="token">${h(created.token)}</p>`), { icon: 'key' }) : ''
  const keys = rows(s, 'integrations')
  const list = keys.length ? `<div class="table-wrap">${table(['Label', 'Scope', 'Location', 'Events', 'Last used', 'Status', ''], keys.map(key => keyRow(s, key, location)).join(''))}</div>` : emptyLine('No integration keys yet. Create one to let another application read your class rosters.')
  const scopes = group('Scope', Object.entries(scopeCatalogue).map(([name, scope]) => check(`sc_${name}`, `${h(scope.label)} (<code>${h(name)}</code>)`, true) + `<p class="meta">${h(scope.reads)}. No money, contact details or notes.</p>`).join(''))
  const create = form('integration.create', '/app/integrations', field('label', 'Key label', '', 'text', 'required maxlength="80" placeholder="Front desk display"')
    + scopes + select('location', 'Location', [['studio', location]], 'studio') + '<p class="meta">Your studio has one location; a key reads all of it.</p>'
    + eventChoices(permitted(Object.keys(scopeCatalogue)), []), 'Create integration key')
  const guide = body(`<p>Send <code>GET /api/strap/integration/roster</code> with <code>Authorization: Bearer SECRET</code> and <code>strap-schema-version: ${h(schemaVersions.at(-1))}</code>. Pages hold 1–100 classes (<code>limit</code>, default 50); pass the returned <code>page.next</code> as <code>cursor</code> for the next page.</p>`
    + `<p>Each key may make ${rateLimit.requests} requests in any ${rateLimit.windowSeconds} seconds. Beyond that Strap answers <code>429</code> with <code>Retry-After</code> in seconds. Writes and every other kind of data are refused.</p><p><a href="https://github.com/just-every/run-strap/blob/main/docs/INTEGRATIONS.md">Read the integration guide</a></p>`)
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Integrations</h1></div><p class="lede">Integration keys let another application read your class rosters, and nothing else. Rotate a secret or revoke a key at any time; each request it makes appears under its usage and failures.</p>${secret}`
    + panel('Integration keys', list, { icon: 'key' })
    + panel('How an integration connects', guide, { icon: 'report' })
    + `</div><aside class="rail">${panel('Create an integration key', body(create), { icon: 'plus' })}</aside></div>`
}

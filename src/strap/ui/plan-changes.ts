// PLAN-005 on the packs page: the member's request, the owner's exact preview
// with its proration formula, and the member's own acceptance.
import { countsCredits } from '../domain/entitlements'
import { packName } from './facts'
import { money, studioToday, when, zoneOf } from './format'
import { body, emptyLine, field, form, h, hidden, owner, panel, person, rows, select, statusPill, textarea } from './shared'
import { packExpiration } from './pack-history'

const path = '/app/packs'
const labelled = (name: string, label: string, choices: [unknown, unknown][], value: unknown = '') => select(name, label, choices, value, `required aria-label="${h(label)}"`)
const packOf = (s: any, id: string) => rows(s, 'packs').find(p => p.id === id)

/** The exact arithmetic the charge or credit uses, in words and numbers. */
export function formulaText(c: any) {
  const f = c.formula
  if (f.kind === 'full-term') return `Next term ${money(f.newAmountCents)} in full: a change at renewal starts a new term, so nothing is prorated.`
  return `(${money(c.amountCents)} − ${money(c.current.amountCents)}) × ${f.remainingSeconds.toLocaleString('en-US')} remaining ÷ ${f.totalSeconds.toLocaleString('en-US')} term seconds (UTC), rounded half-up to the cent = ${money(c.chargeCents)}`
}
const outcome = (c: any) => c.chargeCents > 0 ? `${money(c.chargeCents)} added to your studio balance on the effective date` : c.chargeCents < 0 ? `${money(-c.chargeCents)} credited to your studio balance on the effective date; no money is refunded by Strap` : 'No charge or credit'

function change(s: any, c: any, mine: boolean) {
  const pack = packOf(s, c.packId), credits = c.mode === 'now'
    ? `${c.current.credits} → ${c.credits} credits (${c.creditsDelta > 0 ? '+' : ''}${c.creditsDelta} available); ${c.remainingAfter} available after the change at preview time`
    : `New term with ${c.credits} credits; ${c.expiringCredits} unused credits of the current term expire at its end`
  const status = c.stale ? 'Stale: the pack or another change moved on; ask the studio for a new preview.' : c.status === 'failed' ? `Not applied: ${c.failure.replace(/_/g, ' ')}. No charge was made.` : ''
  const accept = mine && c.status === 'preview' && !c.stale ? form('plan.change.accept', path, hidden('id', c.id) + hidden('key', c.key), 'Accept this exact change') : ''
  return `<div data-plan-change="${h(c.id)}"><h3>${h(mine ? packName(pack ?? c.current) : `${person(s, c.personId)} · ${packName(pack ?? c.current)}`)} · ${statusPill(c.stale ? 'stale' : c.status)}</h3>`
    + `<p>${c.mode === 'now' ? 'Change within the current term' : 'Change at renewal'} · effective ${packExpiration(s, c.effectiveAt)}</p>`
    + `<p>Price ${money(c.current.amountCents)} → ${money(c.amountCents)} · ${h(credits)}</p>`
    + `<p><strong>${h(outcome(c))}</strong></p><p class="meta">${h(formulaText(c))}</p>`
    + `<p class="meta">Next renewal: none automatic. Packs do not auto-renew; this term ends ${packExpiration(s, c.expiresAt)}.</p>`
    + (c.exceptionReason ? `<p class="meta">Studio-approved exception: ${h(c.exceptionReason)}</p>` : '')
    + (c.acceptedAt ? `<p class="meta">Accepted by the member ${when(s, c.acceptedAt)}${c.appliedAt ? ` · applied ${when(s, c.appliedAt)}` : ''}</p>` : '')
    + (status ? `<p class="meta">${h(status)}</p>` : '') + accept + '</div>'
}

export function planChangesPanel(s: any, chosen = '') {
  const mine = !owner(s), data = s.planChanges ?? { requests: [], changes: [] }
  // PLAN-005 changes credit packs; PLAN-002 plans are not offered (the domain refuses them).
  const live = rows(s, 'packs').filter(p => countsCredits(p) && !(s.recurring?.terms ?? []).some((r: any)=>r.status==='active'&&r.currentPackId===p.id) && !(s.freezes?.freezes ?? []).some((f: any)=>f.packId===p.id&&['scheduled','active'].includes(f.status)) && Date.parse(p.expiresAt) > Date.now() && (!chosen || p.personId === chosen))
  const packChoices: [unknown, unknown][] = [['', 'Choose a pack'], ...live.map(p => [p.id, mine ? `${packName(p)} · ${money(p.amountCents)}` : `${person(s, p.personId)} · ${packName(p)} · ${money(p.amountCents)}`] as [unknown, unknown])]
  const changes = data.changes.slice().sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)).map((c: any) => change(s, c, mine)).join('')
  const requests = data.requests.map((r: any) => `<p class="meta" data-plan-request="${h(r.id)}">${h(mine ? 'You asked' : person(s, r.personId) + ' asked')}: ${h(r.note)} · ${statusPill(r.status)} · ${when(s, r.createdAt)}</p>`).join('')
  const request = mine ? (live.length ? form('plan.change.request', path, labelled('packId', 'Pack to change', packChoices) + field('note', 'What would you like to change?', '', 'text', 'required maxlength="500"') + hidden('requestId', crypto.randomUUID()), 'Request a plan change', 'quiet') : '')
    : form('plan.change.prepare', path, labelled('packId', 'Pack to change', packChoices)
      + select('planRequestId', 'Member request', [['', 'No member request'], ...data.requests.filter((r: any) => r.status === 'requested').map((r: any) => [r.id, `${person(s, r.personId)}: ${r.note}`] as [unknown, unknown])], '', 'aria-label="Member request"')
      + labelled('mode', 'When it takes effect', [['now', 'Within the current term (prorated)'], ['renewal', 'At renewal (current term end)']], 'now')
      + `<div class="row2">${field('credits', 'New class credits', '', 'number', 'required min="1" max="10000" step="1"')}${field('amount', 'New price', '', 'text', 'required inputmode="decimal" placeholder="$189.00"')}</div>`
      + `<p>Within the term: the effective date and time on the studio clock (${h(zoneOf(s) ?? 'UTC')}); the member must accept before then. At renewal: the new term’s last day.</p>`
      + `<div class="row2">${field('effectiveDate', 'Effective date', studioToday(s), 'date')}${field('effectiveTime', 'Effective time', '', 'time')}</div>${field('expiresOn', 'New term good through', '', 'date')}`
      + textarea('exceptionReason', 'Exception reason (required for a lower price or fewer credits within the term)', '', 'maxlength="500"')
      + labelled('channel', 'Member asked by', [['desk', 'At the desk'], ['phone', 'Phone'], ['inbox', 'Email or inbox']], 'desk') + hidden('requestId', crypto.randomUUID()), 'Preview plan change')
  const intro = mine ? '<p>Ask the studio to change a pack. You see the exact charge or credit, its formula and the effective date, and nothing changes until you accept.</p>'
    : '<p>Preview a change for a member. The member alone accepts it; a changed pack or another accepted change makes the preview stale. Charges go to the studio balance; Strap collects nothing.</p>'
  return panel('Plan changes', body(intro + (request || '') + (requests || '') + (changes || emptyLine(mine ? 'No plan changes.' : 'No plan change previews.'))), { id: 'plan-changes', icon: 'card', className: mine ? '' : 'desk-form' })
}

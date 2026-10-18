// The agent's place (pick F's right panel): Member success, the members who need
// a follow-up and the work prepared for the owner's approval. Agents prepare
// packs, reminders and class weeks; only the signed-in owner approves them.
import { attendance, balance, classTitle, followUps, habit, lastVisit, livePacks, packName, upcoming, type FollowUp } from './facts'
import { clock, dayOf, dayShort, money, when } from './format'
import { draftGlyph, draftLine, draftPage, draftTitle, preparedBy } from './drafts'
import { icon } from './icons'
import { avatar, form, h, hidden, rows } from './shared'

function weeks(since: string) {
  const days = Math.round((Date.now() - Date.parse(since)) / 86_400_000)
  return days >= 14 ? `${Math.floor(days / 7)} weeks` : `${days} days`
}

/** The next class with an open spot at the hour this member usually comes. */
function openSpot(s: any, personId: string) {
  const visits = rows(s, 'bookings').filter(b => b.personId === personId && b.checkedInAt).map(b => rows(s, 'classes').find(c => c.id === b.classId)).filter(Boolean)
  const usual = new Set(visits.map(c => clock(s, c.start)))
  const open = upcoming(s).filter(c => Date.parse(c.start) > Date.now() && attendance(s, c.id).booked.length < c.capacity)
  return open.find(c => usual.has(clock(s, c.start))) ?? open[0]
}

function card(s: any, f: FollowUp, first: boolean) {
  const facts: string[] = [], packs = livePacks(s, f.personId)
  let action = `<a class="btn-quiet small" href="/app/people?person=${encodeURIComponent(f.personId)}#person">View member</a>`
  let extra = ''
  if (f.kind === 'waiting') {
    const c = rows(s, 'classes').find(c => c.id === f.classId)
    facts.push(`Waiting for ${classTitle(c)}, ${dayShort(s, dayOf(s, c.start))} ${clock(s, c.start)}`, 'No credit covers the class')
    action = `<a class="btn small" href="/app/packs?person=${encodeURIComponent(f.personId)}#prepare-pack">Prepare a pack</a>`
  }
  if (f.kind === 'owes') {
    facts.push(`Owes ${money(balance(s, f.personId))}`, packs.length ? `${packs[0].remaining} credits left` : 'No credits left')
    action = form('reminder.prepare', '/app', hidden('personId', f.personId), 'Prepare a reminder', 'primary', 'small')
  }
  if (f.kind === 'lapsed') {
    const usual = habit(s, f.personId, value => clock(s, value))
    facts.push(...(usual ? [usual] : []), `No visit in ${weeks(lastVisit(s, f.personId))}`)
    const c = first ? openSpot(s, f.personId) : null
    if (c) extra = `<div class="offer">${icon('calendar')}<div><small>Open spot</small><b>${h(dayShort(s, dayOf(s, c.start)))} · ${h(clock(s, c.start))}</b><small>${h(classTitle(c))} · ${c.capacity - attendance(s, c.id).booked.length} open</small></div></div><p>${h(packs[0].remaining)} credits left on their ${h(packName(packs[0]))}. Members book open spots themselves from Classes.</p>`
  }
  if (f.kind === 'expiring') facts.push(`${packName(packs[0])} ends ${dayShort(s, dayOf(s, packs[0].expiresAt))}`, `${packs[0].remaining} credits left`), action = `<a class="btn small" href="/app/packs?person=${encodeURIComponent(f.personId)}#prepare-pack">Prepare a renewal</a>`
  if (f.kind === 'empty') facts.push(rows(s, 'packs').some(p => p.personId === f.personId) ? 'No credits left' : 'No class pack yet'), action = `<a class="btn small" href="/app/packs?person=${encodeURIComponent(f.personId)}#prepare-pack">Prepare a pack</a>`
  return `<article class="followup"><div class="followup-head">${avatar(f.name, 'large')}<div><strong>${h(f.name)}</strong>${facts.map(line => `<p>${h(line)}</p>`).join('')}</div></div>${extra}<div class="actions">${action}</div></article>`
}

export function successRail(s: any, query: URLSearchParams) {
  const tab = query.get('panel') === 'recent' ? 'recent' : 'follow'
  const items = followUps(s), keep = new URLSearchParams(query)
  const href = (value: string) => { keep.set('panel', value); return `/app?${keep}` }
  const tabs = `<nav class="tabs" aria-label="Member success"><a href="${h(href('follow'))}"${tab === 'follow' ? ' aria-current="page"' : ''}>Follow ups${items.length ? ` <span class="badge">${items.length}</span>` : ''}</a><a href="${h(href('recent'))}"${tab === 'recent' ? ' aria-current="page"' : ''}>Recent</a></nav>`
  const recent = rows(s, 'approvals').sort((a, b) => b.approvedAt.localeCompare(a.approvedAt)).slice(0, 5)
  const drafts = new Map(rows(s, 'drafts').map(d => [d.id, d]))
  const body = tab === 'follow'
    ? (items.length ? `<div class="followups">${items.slice(0, 3).map(f => card(s, f, f === items.find(x => x.kind === 'lapsed'))).join('')}${items.length > 3 ? `<p class="meta">${items.length - 3} more in <a href="/app/people">People</a>.</p>` : ''}</div>` : `<p class="panel-empty">${rows(s, 'people').some(p => p.role === 'member') ? 'No follow-ups right now.' : 'Members who need a follow-up appear here: a waitlist with no credit, a balance, a pack running out or a regular who stopped coming.'}</p>`)
    : (recent.length ? `<div class="approvals">${recent.map(a => { const d = drafts.get(a.draftId); return `<div class="approval"><span class="approval-mark">${icon(draftGlyph(a))}</span><div><strong>${h(draftTitle(a))} approved</strong>${d ? `<p>${h(draftLine(s, d))}</p>` : ''}<small>${when(s, a.approvedAt)}</small></div><span></span></div>` }).join('')}</div>` : '<p class="panel-empty">Approvals you make appear here.</p>')
  const success = `<section class="panel"><div class="success-head">${icon('sparkles')}<h2>Member success</h2></div>${tabs}${body}</section>`
  const pending = rows(s, 'drafts').filter(d => d.status === 'draft').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const name = (s.displayName || 'the owner').split(' ')[0]
  const approvals = `<section class="panel" id="approvals"><div class="panel-head">${icon('clock')}<h2>Pending approvals</h2>${pending.length ? `<span class="badge">${pending.length}</span>` : ''}</div>`
    + (pending.length ? `<div class="approvals">${pending.map(d => `<div class="approval"><span class="approval-mark">${icon(draftGlyph(d))}</span><div><strong>${h(draftTitle(d))}</strong><p>${h(draftLine(s, d))}</p><small>${preparedBy(s, d)}</small></div><a class="btn-quiet small" href="${draftPage(d)}#draft-${h(d.id)}">Review</a></div>`).join('')}</div>` : '<p class="panel-empty">Nothing is waiting for approval.</p>')
    + `<p class="panel-note">Each needs ${h(name)}’s approval. Your agent prepares packs, reminders and class weeks; it never approves them, and it never refunds, freezes or changes a plan.</p></section>`
  return success + approvals
}

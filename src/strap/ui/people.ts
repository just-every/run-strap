import { memberHistoryPanel, memberRecordAccess, memberRecordDesk } from './member-records'
import { reservationsPanel } from './reservations'
import { feesPanel } from './fees'
// People: members and instructors in a searchable list beside one person's own
// card (credits, balance, visits and bookings), editing, invitations and erasure.
import { draftRecords } from './drafts'
import { attendance, balance, classTitle, lastVisit, livePacks, packLeft, packName } from './facts'
import { countsCredits, planTerms } from '../domain/entitlements'
import { clock, dayOf, dayShort, datePlain, money, when } from './format'
import { personCheckin } from './checkin'
import { staffCancelControls } from './booking-rules'
import { bookingControls, canRestore, cancellationReasonsPanel, cancellationsPanel } from './booking-actions'
import { staffActionHistory, staffProfileActions } from './staff-actions'
import { contactText, phoneText, staffProfileEditor } from './profile'
import { avatar, body, cell, emptyLine, emptyState, field, form, h, hidden, owner, panel, rows, select, statusPill, table } from './shared'

const personFields = (p?: any) => `<div class="row2">${field('name', 'Full name', p?.name, 'text', 'required maxlength="160" autocomplete="name"')}${field('email', 'Email', p?.email, 'email', 'required autocomplete="email"')}</div>${field('phone', 'Mobile phone (members; for kiosk check-in)', p?.phone ? p.phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') : '', 'tel', 'autocomplete="tel" maxlength="20"')}<div class="row2">${select('role', 'Role', [['member', 'Member'], ['instructor', 'Instructor']], p?.role ?? 'member')}${select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], p ? String(p.active) : 'true')}</div>`

function card(s: any, p: any, back: string) {
  const packs = livePacks(s, p.id), credits = packs.filter(countsCredits).reduce((n, x) => n + x.remaining, 0), visit = lastVisit(s, p.id)
  const bookings = rows(s, 'bookings').filter(b => b.personId === p.id).map(b => ({ b, c: rows(s, 'classes').find(c => c.id === b.classId) })).filter(x => x.c && Date.parse(x.c.start) > Date.now() && (x.b.status !== 'cancelled' || canRestore(x.c, x.b))).sort((a, b) => a.c.start.localeCompare(b.c.start))
  const teaching = rows(s, 'classes').filter(c => c.instructorId === p.id && Date.parse(c.start) > Date.now()).sort((a, b) => a.start.localeCompare(b.start))
  const upcomingList = p.role === 'instructor'
    ? (teaching.length ? `<div class="table-wrap">${table(['Teaching', 'Class', '>Booked'], teaching.slice(0, 8).map(c => `<tr>${cell('Teaching', `${h(dayShort(s, dayOf(s, c.start, c.timeZone)))} · ${h(clock(s, c.start, c.timeZone))}`)}${cell('Class', h(classTitle(c)))}${cell('Booked', `${attendance(s, c.id).booked.length} of ${c.occupancy.total}`, 'right')}</tr>`).join(''))}</div>` : emptyLine('No upcoming classes to teach.'))
    : (bookings.length ? `<div class="table-wrap">${table(['Booked', 'Class', '>Status'], bookings.map(({ b, c }) => `<tr>${cell('Booked', `${h(dayShort(s, dayOf(s, c.start, c.timeZone)))} · ${h(clock(s, c.start, c.timeZone))}`)}${cell('Class', h(classTitle(c)))}${cell('Status', b.status === 'booked' ? '<span class="pill done">Booked</span>' : b.status === 'cancelled' ? '<span class="pill quiet">Cancelled</span>' : b.status === 'offered' ? '<span class="pill pending">Spot offered</span>' : '<span class="pill pending">Waitlist</span>', 'right')}</tr>${owner(s) ? `<tr><td colspan="3">${b.status !== 'cancelled' ? `<details class="more"><summary>Cancel booking</summary><div class="panel-body">${staffCancelControls(s, b, back)}</div></details>` : ''}${bookingControls(s, c, b, back)}</td></tr>` : ''}`).join(''))}</div>` : emptyLine('No upcoming bookings.'))
  const stats = p.role === 'member' ? `<div class="stat-row"><div class="stat"><b>${credits}</b><small>credits left</small></div><div class="stat"><b>${money(balance(s, p.id))}</b><small>owed</small></div><div class="stat"><b>${visit ? h(datePlain(dayOf(s, visit)).replace(/, \d{4}$/, '')) : '—'}</b><small>last visit</small></div></div>` : ''
  const packLines = packs.map(x => `<p class="meta">${h(packName(x))}: ${countsCredits(x) ? '' : `${h(planTerms(x.entitlement))}; `}${h(packLeft(x))}, good through ${h(datePlain(dayOf(s, x.expiresAt)))}</p>`).join('')
  const actions = `<div class="actions">${p.active ? form('person.invite', back, hidden('id', p.id), 'Invite to sign in', 'quiet', 'small') : ''}${p.role === 'member' && p.active ? `<a class="btn small" href="/app/packs?person=${encodeURIComponent(p.id)}#prepare-pack">Prepare a pack</a>` : ''}</div>`
  const contact = p.role === 'member' ? `<p class="meta" data-emergency-contact>Emergency contact: ${h(contactText(p.emergencyContact))}</p>` : ''
  return `<section class="panel person-card" id="person"><div class="person-top">${avatar(p.name, 'large')}<div><h2>${h(p.name)}</h2><p>${h(p.email)}${p.phone ? ` · ${h(phoneText(p.phone))}` : ''} · ${p.role === 'member' ? 'Member' : 'Instructor'} · ${p.active ? 'Active' : 'Inactive'}</p></div></div>${stats}<div class="panel-body">${contact}${packLines}${actions}</div>${upcomingList}`
    + (p.role === 'member' ? feesPanel(s,p.id,back) : '')
    + personCheckin(s, p, back)
    + (p.role === 'member' ? reservationsPanel(s,p.id,back) : '')
    + (p.role === 'member' ? memberHistoryPanel(s,p,back) : '')
    + staffProfileEditor(s, p, back)
    + staffProfileActions(s, p, back)
    + (p.role === 'member'
      ? `<details class="more"><summary>Sign-in and access</summary><div class="panel-body"><p class="meta">The sign-in email is an identity change only you make; Strap records it in the member’s profile changes.</p>${form('person.save', back, hidden('id', p.id) + hidden('version', p.version) + hidden('name', p.name) + `<div class="row2">${field('email', 'Sign-in email', p.email, 'email', 'required autocomplete="email"')}${select('role', 'Role', [['member', 'Member'], ['instructor', 'Instructor']], p.role)}</div>` + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], String(p.active)), 'Save sign-in and access')}</div></details>`
      : `<details class="more"><summary>Edit ${h(p.name.split(' ')[0])}</summary><div class="panel-body">${form('person.save', back, hidden('id', p.id) + personFields(p), 'Save changes')}</div></details>`)
    + `<details class="more"><summary>Erase personal data</summary><div class="panel-body"><p class="meta">Only people with no bookings, packs, payments, sign-in or import history can be erased. Make anyone else inactive to end their access.</p>${form('person.erase', '/app/people', hidden('id', p.id) + '<label class="check"><input type="checkbox" required>I understand this erases this person’s personal data.</label>', 'Erase this person', 'quiet')}</div></details></section>`
}

export function peoplePage(s: any, query: URLSearchParams) {
  if (s.actor.role === 'front-desk') return memberRecordDesk(s,query)
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const all = rows(s, 'people').sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
  const list = q ? all.filter(p => p.name.toLowerCase().includes(q) || String(p.email).toLowerCase().includes(q)) : all
  const chosen = all.find(p => p.id === query.get('person'))
  const back = `/app/people${query.size ? `?${query.toString()}` : ''}`
  const members = all.filter(p => p.role === 'member' && p.active).length, instructors = all.filter(p => p.role === 'instructor' && p.active).length
  const table_ = list.length ? `<div class="table-wrap">${table(['Name', 'Role', 'Credits', 'Last visit', 'Status'], list.map(p => {
    const credits = livePacks(s, p.id).filter(countsCredits).reduce((n, x) => n + x.remaining, 0), visit = lastVisit(s, p.id)
    return `<tr${chosen === p ? ' class="current"' : ''}>${cell('Name', `<div class="who">${avatar(p.name)}<div><a href="/app/people?person=${encodeURIComponent(p.id)}${q ? `&amp;q=${encodeURIComponent(q)}` : ''}#person">${h(p.name)}</a><small>${h(p.email)}</small></div></div>`)}${cell('Role', `<span class="chip${p.role === 'instructor' ? ' plum' : ' quiet'}">${p.role === 'member' ? 'Member' : 'Instructor'}</span>`, 'bare')}${cell('Credits', p.role === 'member' ? String(credits) : '—')}${cell('Last visit', visit ? when(s, visit) : '—')}${cell('Status', statusPill(p.active ? 'active' : 'inactive'), 'bare')}</tr>`
  }).join(''))}</div>` : q ? emptyLine(`No one matches “${query.get('q')}”.`) : emptyState('users', 'No members yet', 'Add your first member or instructor, or import members from a Mindbody CSV.', '<a class="btn" href="#add-person">Add a person</a>')
  const search = `<form class="search" method="get" action="/app/people" role="search"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg><label class="visually-hidden" for="people-q">Search people</label><input id="people-q" name="q" type="search" value="${h(query.get('q') ?? '')}" placeholder="Search by name or email"></form>`
  const add = panel('Add a person', body(form('person.save', '/app/people', personFields(), 'Add person')), { id: 'add-person', icon: 'addperson' })
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>People</h1><p>${members} active members · ${instructors} instructors</p></div>`
    + panel(q ? `Matching “${query.get('q')}”` : 'Members and instructors', `<div class="panel-body">${search}</div>${table_}`, { icon: 'users' })
    + panel('Booking changes awaiting approval', draftRecords(s, '/app/people', ['booking-change']).html, {icon:'calendar'})
    + cancellationsPanel(s, query)
    + staffActionHistory(s, query)
    + memberRecordAccess(s)
    + `</div><aside class="rail">${chosen ? card(s, chosen, back) : ''}${add}${cancellationReasonsPanel(s)}</aside></div>`
}

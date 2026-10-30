// The app's frame (pick F): sidebar with the mark, location and navigation, the
// account at its foot, and the top bar with the day, search and the desk's actions.
import branding from '../../branding.json'
import { fontHead } from '../../base/font-head'
import { icon, sprite } from './icons'
import { avatar, h, owner, rows } from './shared'

export interface Tab { href: string; label: string; glyph: string; count?: number }

export function tabs(s: any): Tab[] {
  const courseTab: Tab = {href:'/app/courses',label:'Courses',glyph:'calendar'}
  const security: Tab = { href: '/app/security', label: 'Security', glyph: 'key' }
  if (s.actor.role === 'front-desk') return [courseTab,...(s.saleGrant?.enabled ? [{href:'/app/retail',label:'Gift sales',glyph:'card'}] : []),{href:'/app/referrals',label:'Referrals',glyph:'users'},{href:'/app/intake',label:'Intake forms',glyph:'report'},{href:'/app/people',label:'Member records',glyph:'users'},security]
  if (s.actor.role === 'manager') return [...(s.actor.staffAccess ? [courseTab] : []),...(s.actor.staffAccess ? [{href:'/app/people',label:'Member records',glyph:'users'}] : []),{ href: '/app/time-clock', label: 'Time clock', glyph: 'today' }, { href: '/app/revenue', label: 'Revenue reports', glyph: 'report' }, { href: '/app/reports', label: 'Attendance reports', glyph: 'report' }, security]
  if (s.actor.role === 'finance') return [{ href: '/app/revenue', label: 'Revenue reports', glyph: 'report' }, security]
  const waiting = (types: string[]) => rows(s, 'drafts').filter(d => d.status === 'draft' && types.includes(d.type)).length
  if (owner(s)) return [
    { href: '/app', label: 'Today', glyph: 'today' },
    { href: '/app/classes', label: 'Classes', glyph: 'calendar', count: waiting(['classes']) },
    { href: '/app/people', label: 'People', glyph: 'users' },
    { href: '/app/households', label: 'Households', glyph: 'users' },
    { href: '/app/intake', label: 'Intake forms', glyph: 'report' },
    { href: '/app/tuition', label: 'Family tuition', glyph: 'card' }, courseTab,
    { href: '/app/leads', label: 'Lead follow-up', glyph: 'users' },
    { href: '/app/recognition', label: 'Visit recognition', glyph: 'users' },
    { href: '/app/makeups', label: 'Absences and makeups', glyph: 'calendar' },
    { href: '/app/retail', label: 'Inventory and drawers', glyph: 'card' },
    { href: '/app/packs', label: 'Packs and payments', glyph: 'card', count: waiting(['pack', 'reminder']) },
    { href: '/app/revenue', label: 'Revenue reports', glyph: 'report' },
    { href: '/app/renewals', label: 'Renewal worklist', glyph: 'report' },
    { href: '/app/retention', label: 'Retention cohorts', glyph: 'report' },
    { href: '/app/reports', label: 'Attendance reports', glyph: 'report' },
    { href: '/app/time-clock', label: 'Time clock', glyph: 'today' },
    { href: '/app/teaching-pay', label: 'Teaching pay', glyph: 'report' },
    { href: '/app/substitutions', label: 'Instructor substitutions', glyph: 'users' },
    { href: '/app/import', label: 'Import', glyph: 'upload' },
    { href: '/app/agent', label: 'Agent access', glyph: 'sparkles' },
    { href: '/app/integrations', label: 'Integrations', glyph: 'key' },
    security,
  ]
  if (s.actor.role === 'instructor') return [
    ...(s.actor.staffAccess ? [{href:'/app/people',label:'Member records',glyph:'users'}] : []),
    { href: '/app', label: 'Today', glyph: 'today' },
    { href: '/app/classes', label: 'My classes', glyph: 'calendar' },
    { href: '/app/time-clock', label: 'Time clock', glyph: 'today' },
    { href: '/app/teaching-pay', label: 'My teaching pay', glyph: 'report' },
    { href: '/app/substitutions', label: 'Instructor substitutions', glyph: 'users' },
    { href: '/app/packs', label: 'My packs', glyph: 'card' },
    security,
  ]
  const member: Tab[] = [{href:'/app/offers',label:'Studio offers',glyph:'calendar'},{ href: '/app/intake', label: 'Intake forms', glyph: 'report' },
    { href: '/app/tuition', label: 'Family tuition', glyph: 'card' }, courseTab, { href: '/app', label: 'Classes', glyph: 'calendar' }, { href: '/app/makeups', label: 'Absences and makeups', glyph: 'calendar' }, { href: '/app/packs', label: 'My packs', glyph: 'card' }, { href: '/app/profile', label: 'My profile', glyph: 'users' }, { href: '/app/recognition', label: 'Visit recognition', glyph: 'users' }, security]
  return rows(s, 'households').length ? [...member.slice(0, -1), { href: '/app/household', label: 'My household', glyph: 'users' }, member.at(-1)!] : member
}

const roleName = (s: any) => ({ owner: 'Owner', instructor: 'Instructor', member: 'Member', finance: 'Finance', manager: 'Manager' } as Record<string, string>)[s.actor.role] ?? s.actor.role

export function shell(s: any, current: string, title: string, top: string, content: string, notices: string) {
  const name = h(branding.name), me = s.displayName || s.actor.email
  const nav = `<nav class="nav" aria-label="Studio">${tabs(s).map(t => `<a href="${t.href}"${t.href === current ? ' aria-current="page"' : ''}>${icon(t.glyph)}<span>${h(t.label)}</span>${t.count ? `<span class="badge" aria-label="${t.count} waiting for approval">${t.count}</span>` : ''}</a>`).join('')}</nav>`
  const place = s.studio?.location ?? (owner(s) ? 'Set location' : branding.name)
  // One location per installation: the row edits it in Studio settings; it switches nothing.
  const location = owner(s) ? `<a class="location" href="/app/studio" title="Studio settings"${current === '/app/studio' ? ' aria-current="page"' : ''}>${icon('pin')}<span>${h(place)}</span><span class="edit">${icon('pencil')}<span class="visually-hidden">Edit in Studio settings</span></span></a>` : `<p class="location">${icon('pin')}<span>${h(place)}</span></p>`
  const account = `<div class="account"><div class="profile">${avatar(me)}<div><strong>${h(me)}</strong><small>${h(roleName(s))}</small></div></div><div class="account-links">${owner(s) ? '<a href="/auth/settings/identity">Sign-in settings</a>' : ''}<form method="post" action="/app/action?name=session.signout&amp;returnTo=/app"><button class="btn-quiet small" type="submit">Sign out</button></form></div></div>`
  const sidebar = `<aside class="sidebar"><a class="brand" href="/app" aria-label="${name} home"><img src="/brand/mark.svg" alt="" width="46" height="46"><span data-rer-name>${name}</span></a>${location}${nav}${account}`
    + `<details class="menu"><summary>${icon('menu')}Menu</summary><div class="menu-sheet">${location}${nav}${account}</div></details></aside>`
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} · ${name}</title><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">`
    + `<link rel="stylesheet" href="/rer-theme.css">${fontHead}<link rel="stylesheet" href="/brand/app/shell.css"><link rel="stylesheet" href="/brand/app/today.css"><link rel="stylesheet" href="/brand/app/pages.css"></head>`
    + `<body>${sprite}<a class="skip" href="#content">Skip to content</a><div class="app">${sidebar}<main class="workspace" id="content" tabindex="-1"><div class="topbar">${top}</div>${notices}${content}</main></div><script src="/brand/profile-save.js" defer></script></body></html>`
}

/** The top bar: the day on the left; member search, Check in and Add person for the owner. */
export function topBar(s: any, day: string, checkIn: string) {
  const search = owner(s) ? `<form class="search" method="get" action="/app/people" role="search">${icon('search')}<label class="visually-hidden" for="member-search">Search members</label><input id="member-search" name="q" type="search" placeholder="Search members by name or email"></form>` : ''
  const actions = owner(s) || s.actor.role === 'instructor' ? `<a class="btn-quiet" href="${h(checkIn)}">${icon('scan')}Check in</a>` : ''
  return `${day}${search}${actions}${owner(s) ? `<a class="btn" href="/app/people#add-person">${icon('plus')}Add person</a>` : ''}`
}

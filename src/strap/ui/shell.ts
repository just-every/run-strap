// The app's frame (pick F): sidebar with the mark, location and navigation, the
// account at its foot, and the top bar with the day, search and the desk's actions.
import branding from '../../branding.json'
import { fontHead } from '../../base/font-head'
import { icon, sprite } from './icons'
import { avatar, h, owner, rows } from './shared'

export interface Tab { href: string; label: string; glyph: string; count?: number }

export function tabs(s: any): Tab[] {
  const waiting = (types: string[]) => rows(s, 'drafts').filter(d => d.status === 'draft' && types.includes(d.type)).length
  if (owner(s)) return [
    { href: '/app', label: 'Today', glyph: 'today' },
    { href: '/app/classes', label: 'Classes', glyph: 'calendar', count: waiting(['classes']) },
    { href: '/app/people', label: 'People', glyph: 'users' },
    { href: '/app/leads', label: 'Lead follow-up', glyph: 'users' },
    { href: '/app/recognition', label: 'Visit recognition', glyph: 'users' },
    { href: '/app/packs', label: 'Packs and payments', glyph: 'card', count: waiting(['pack', 'reminder']) },
    { href: '/app/reports', label: 'Attendance reports', glyph: 'report' },
    { href: '/app/teaching-pay', label: 'Teaching pay', glyph: 'report' },
    { href: '/app/substitutions', label: 'Instructor substitutions', glyph: 'users' },
    { href: '/app/import', label: 'Import', glyph: 'upload' },
    { href: '/app/agent', label: 'Agent access', glyph: 'sparkles' },
  ]
  if (s.actor.role === 'instructor') return [
    { href: '/app', label: 'Today', glyph: 'today' },
    { href: '/app/classes', label: 'My classes', glyph: 'calendar' },
    { href: '/app/teaching-pay', label: 'My teaching pay', glyph: 'report' },
    { href: '/app/substitutions', label: 'Instructor substitutions', glyph: 'users' },
    { href: '/app/packs', label: 'My packs', glyph: 'card' },
  ]
  return [{ href: '/app', label: 'Classes', glyph: 'calendar' }, { href: '/app/packs', label: 'My packs', glyph: 'card' }, { href: '/app/recognition', label: 'Visit recognition', glyph: 'users' }]
}

const roleName = (s: any) => ({ owner: 'Owner', instructor: 'Instructor', member: 'Member' } as Record<string, string>)[s.actor.role] ?? s.actor.role

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
    + `<body>${sprite}<a class="skip" href="#content">Skip to content</a><div class="app">${sidebar}<main class="workspace" id="content"><div class="topbar">${top}</div>${notices}${content}</main></div></body></html>`
}

/** The top bar: the day on the left; member search, Check in and Add person for the owner. */
export function topBar(s: any, day: string, checkIn: string) {
  const search = owner(s) ? `<form class="search" method="get" action="/app/people" role="search">${icon('search')}<label class="visually-hidden" for="member-search">Search members</label><input id="member-search" name="q" type="search" placeholder="Search members by name or email"></form>` : ''
  const actions = owner(s) || s.actor.role === 'instructor' ? `<a class="btn-quiet" href="${h(checkIn)}">${icon('scan')}Check in</a>` : ''
  return `${day}${search}${actions}${owner(s) ? `<a class="btn" href="/app/people#add-person">${icon('plus')}Add person</a>` : ''}`
}

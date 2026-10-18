import { fontHead } from '../../base/font-head'
import branding from '../../branding.json'
import { agent } from './agent'
import { classes } from './classes'
import { movein } from './import'
import { packs } from './packs'
import { people } from './people'
import { h, owner } from './shared'
import { style } from './style'

// The app's one inline style is admitted by its hash, computed once per isolate.
let styleHash: Promise<string> | undefined
const hashStyle = async () => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(style)))))

export async function renderApp(state: any, path: string, notice: { message?: string; error?: string; result?: any } = {}): Promise<Response> {
 const current = path.split('?')[0].replace(/\/$/, '') || '/app'
 const tabs = [['/app', 'Classes'], ['/app/packs', owner(state) ? 'Packs and payments' : 'My packs'], ...(owner(state) ? [['/app/people', 'People'], ['/app/import', 'Import'], ['/app/agent', 'Agent access']] : [])]
 const allowed = tabs.some(([url]) => url === current)
 const title = tabs.find(([url]) => url === current)?.[1] ?? 'Page unavailable'
 const content = !allowed ? '<h1>Page unavailable</h1><p class="lede">Your role cannot access this page.</p><p><a class="btn" href="/app">Open classes</a></p>' : current === '/app/people' ? people(state) : current === '/app/packs' ? packs(state) : current === '/app/import' ? movein(state, notice) : current === '/app/agent' ? agent(state, notice) : classes(state)
 const name = h(branding.name)
 const header = `<header class="top"><a class="lockup" href="/app" aria-label="${name} home"><img src="/brand/mark.svg" alt="" width="28" height="28"><span data-rer-name>${name}</span></a><p class="who">${h(state.actor.email)} · ${h(state.actor.role)}</p>${owner(state) ? '<a class="settings" href="/auth/settings/identity">Sign-in settings</a>' : ''}<form class="signout" method="post" action="/app/action?name=session.signout&amp;returnTo=/app"><button class="btn-outline" type="submit">Sign out</button></form></header>`
 const nav = `<nav class="studio" aria-label="Studio">${tabs.map(([url, text]) => `<a href="${h(url)}"${current === url ? ' aria-current="page"' : ''}>${h(text)}</a>`).join('')}</nav>`
 const notices = `${notice.error ? `<div class="notice error" role="alert">${h(notice.error)}</div>` : ''}${notice.message ? `<div class="notice" role="status">${h(notice.message)}</div>` : ''}`
 const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} · ${name}</title><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">${fontHead}<link rel="stylesheet" href="/rer-theme.css"><style>${style}</style></head><body><a class="skip" href="#content">Skip to content</a>${header}<div class="shell">${nav}<main id="content">${notices}${content}</main></div></body></html>`
 return new Response(html, { status: allowed ? 200 : 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; style-src 'self' 'sha256-${await (styleHash ??= hashStyle())}'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' } })
}

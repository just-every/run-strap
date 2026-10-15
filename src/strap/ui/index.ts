import { fontHead } from '../../base/font-head'
import { themeFrame } from '../../base/theme-frame'
import branding from '../../branding.json'
import { agent } from './agent'
import { classes } from './classes'
import { movein } from './import'
import { mail } from './mail'
import { packs } from './packs'
import { people } from './people'
import { h, owner } from './shared'
import { style } from './style'

export async function renderApp(state: any, path: string, notice: { message?: string; error?: string; result?: any } = {}): Promise<Response> {
 const current = path.split('?')[0].replace(/\/$/, '') || '/app'
 const tabs = [['/app', 'Classes'], ['/app/packs', owner(state) ? 'Packs and payments' : 'My packs'], ...(owner(state) ? [['/app/people', 'People'], ['/app/import', 'Import'], ['/app/agent', 'Agent access'], ...(state.localMail ? [['/app/mail', 'Local mail']] : [])] : [])]
 const allowed = tabs.some(([url]) => url === current)
 const title = tabs.find(([url]) => url === current)?.[1] ?? 'Page unavailable'
 const content = !allowed ? '<h1>Page unavailable</h1><p>Your role cannot access this page.</p><p><a href="/app">Open classes</a></p>' : current === '/app/people' ? people(state) : current === '/app/packs' ? packs(state) : current === '/app/import' ? movein(state, notice) : current === '/app/agent' ? agent(state, notice) : current === '/app/mail' ? mail(state) : classes(state)
 const frame = await themeFrame({ href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor })
 const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(style)))))
 const policy = frame.policy.replace("style-src 'self'", `style-src 'self' 'sha256-${hash}'`)
 const html = `<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} · ${h(branding.name)}</title>${fontHead}${frame.head}<style>${style}</style></head><body><main id="main"><a class="skip" href="#content">Skip to content</a><header class="app-header"><a href="/app" aria-label="${h(branding.name)} home">${frame.brand}</a><div class="identity"><span>${h(state.actor.email)} · ${h(state.actor.role)}</span>${owner(state) ? '<a href="/auth/settings/identity">Sign-in settings</a>' : ''}<form method="post" action="/app/action?name=session.signout&amp;returnTo=/app"><button type="submit">Sign out</button></form></div></header><nav aria-label="Studio">${tabs.map(([url, text]) => `<a href="${h(url)}" ${current === url ? 'aria-current="page"' : ''}>${h(text)}</a>`).join('')}</nav><div id="content">${notice.error ? `<div class="notice error" role="alert">${h(notice.error)}</div>` : ''}${notice.message ? `<div class="notice" role="status">${h(notice.message)}</div>` : ''}${content}</div></main></body></html>`
 return new Response(html, { status: allowed ? 200 : 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; ${policy}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' } })
}

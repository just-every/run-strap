// The kiosk's screens: look up by name or phone, or scan a code. A kiosk shows
// a first name, last initial and the class, never balances, packs, waivers,
// contact details or staff alerts.
import branding from '../../branding.json'
import { fontHead } from '../../base/font-head'
import { h } from './shared'

const security = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }
const clock = (zone: string, at: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(at)).replace(' AM', ' am').replace(' PM', ' pm')

export function kioskPage(title: string, content: string, status = 200, headers: Record<string, string> = {}) {
  const name = h(branding.name)
  return new Response(`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} · ${name}</title><link rel="icon" href="/favicon.ico" sizes="32x32">`
    + `<link rel="stylesheet" href="/rer-theme.css">${fontHead}<link rel="stylesheet" href="/brand/app/shell.css"><link rel="stylesheet" href="/brand/app/pages.css"></head>`
    + `<body><main class="workspace kiosk" id="content"><div class="page single"><div class="page-main"><div class="page-title"><h1>${h(title)}</h1><p>${name} check-in</p></div>${content}</div></div></main></body></html>`, { status, headers: { ...security, ...headers } })
}

const searchForms = `<section class="panel"><div class="panel-body"><form class="form" method="post" action="/kiosk/lookup"><label class="field"><span>Your name or phone number</span><input name="q" type="search" autocomplete="off" required minlength="2" maxlength="80"></label><button class="btn" type="submit">Find my class</button></form></div></section>`
  + `<section class="panel"><div class="panel-body"><form class="form" method="post" action="/kiosk/scan"><label class="field"><span>Scan your check-in code</span><input name="code" type="text" autocomplete="off" required maxlength="64" autofocus></label><button class="btn-quiet" type="submit">Check in with code</button></form></div></section>`

export const kioskHome = (message = '', status = 200) => kioskPage('Check in', `${message}${searchForms}`, status)
export const kioskMessage = (text: string, tone: 'error' | 'ok' = 'error') => `<div class="notice${tone === 'error' ? ' error' : ''}" role="${tone === 'error' ? 'alert' : 'status'}">${h(text)}</div>`

export function kioskResults(zone: string, rows: { bookingId: string; name: string; classTitle: string; start: string; checkedIn: boolean }[]) {
  if (!rows.length) return kioskHome(kioskMessage('No booking found. Check the spelling, or ask at the front desk.'), 404)
  const list = rows.map(r => `<tr><td data-label="Name"><strong>${h(r.name)}</strong></td><td data-label="Class">${h(r.classTitle)} · ${h(clock(zone, r.start))}</td><td class="act">${r.checkedIn ? '<span class="pill done">Checked in</span>' : `<form class="inline-form" method="post" action="/kiosk/checkin"><input type="hidden" name="id" value="${h(r.bookingId)}"><button class="btn small" type="submit">Check in</button></form>`}</td></tr>`).join('')
  return kioskPage('Choose your class', `<section class="panel"><table class="data stack"><thead><tr><th>Name</th><th>Class</th><th><span class="visually-hidden">Action</span></th></tr></thead><tbody>${list}</tbody></table></section><p class="meta"><a href="/kiosk">Start over</a></p>`)
}

export const kioskDone = (zone: string, done: { name: string; classTitle: string; start: string }) =>
  kioskHome(kioskMessage(`You’re checked in, ${done.name}: ${done.classTitle} at ${clock(zone, done.start)}.`, 'ok'))

export const kioskPairPage = (token: string) => kioskPage('Pair this kiosk', `<section class="panel"><div class="panel-body"><p>This device becomes the studio’s check-in kiosk. It can only look up today’s booked classes and check people in. It cannot open the studio app.</p><form class="inline-form" method="post" action="/kiosk/pair"><input type="hidden" name="token" value="${h(token)}"><button class="btn" type="submit">Pair this device</button></form></div></section>`)
export const kioskUnpaired = (status = 401) => kioskPage('Kiosk not paired', `<section class="panel"><div class="panel-body"><p>This device is not a paired check-in kiosk, or the studio owner revoked it. The owner pairs a kiosk from Studio settings.</p></div></section>`, status)

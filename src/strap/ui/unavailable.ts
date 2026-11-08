import branding from '../../branding.json'
import { fontHead } from '../../base/font-head'
import { h } from './shared'

/** An unavailable read must not depend on the data store that just failed. */
export function unavailablePage(target: string, reason: 'read' | 'uncertain' | 'denied' | 'ended' | 'cross-site' = 'read') {
  const ended = reason === 'ended', foreign = reason === 'cross-site', denied = reason === 'denied' || ended || foreign
  const title = ended ? 'Studio access ended' : foreign ? 'Request from another site' : denied ? 'Page unavailable' : 'Page not loaded'
  const message = ended ? 'Your studio access is no longer active. Ask the studio owner to review your access, or sign out to use another account.'
    : foreign ? 'This request came from another site and was refused. Return to Strap and use the form there.'
    : denied
    ? 'Your current access does not allow this page. Return to your available pages or ask the studio owner to review your access.'
    : reason === 'uncertain'
    ? 'The latest result could not be loaded. Your action may have completed. Check the current record before making another change.'
    : 'The current studio record could not be loaded. Try loading it again when the connection returns.'
  const back = ended ? '' : `<a class="btn" href="${h(target)}">${foreign ? 'Back to Strap' : denied ? 'Back to available pages' : 'Load current record'}</a>`
  return new Response(`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Strap</title><link rel="stylesheet" href="/rer-theme.css">${fontHead}<link rel="stylesheet" href="/brand/app/shell.css"><link rel="stylesheet" href="/brand/app/pages.css"></head><body><main class="workspace"><div class="page single"><section class="panel"><div class="panel-body"><p><img src="/brand/mark.svg" width="48" height="48" alt="${h(branding.name)}"></p><h1>${title}</h1><p class="notice error" data-app-notice role="alert" tabindex="-1">${message}</p>${back}${denied && !foreign ? '<form method="post" action="/app/action?name=session.signout"><button class="btn-quiet" type="submit">Sign out</button></form>' : ''}</div></section></div></main><script src="/instance/profile-save.js" defer></script></body></html>`, {
    status: denied ? 403 : 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" },
  })
}

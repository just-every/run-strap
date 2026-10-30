import { fontHead } from '../../base/font-head'
import { h } from './shared'

/** An unavailable read must not depend on the data store that just failed. */
export function unavailablePage(target: string, reason: 'read' | 'uncertain' | 'denied' = 'read') {
  const denied = reason === 'denied', title = denied ? 'Page unavailable' : 'Page not loaded'
  const message = denied
    ? 'Your current access does not allow this page. Return to your available pages or ask the studio owner to review your access.'
    : reason === 'uncertain'
    ? 'The latest result could not be loaded. Your action may have completed. Check the current record before making another change.'
    : 'The current studio record could not be loaded. Try loading it again when the connection returns.'
  return new Response(`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Strap</title><link rel="stylesheet" href="/rer-theme.css">${fontHead}<link rel="stylesheet" href="/brand/app/shell.css"><link rel="stylesheet" href="/brand/app/pages.css"></head><body><main class="workspace"><div class="page single"><section class="panel"><div class="panel-body"><h1>${title}</h1><p class="notice error" data-app-notice role="alert" tabindex="-1">${message}</p><a class="btn" href="${h(target)}">${denied ? 'Back to available pages' : 'Load current record'}</a></div></section></div></main><script src="/instance/profile-save.js" defer></script></body></html>`, {
    status: denied ? 403 : 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
  })
}

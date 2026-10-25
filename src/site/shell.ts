// The run site's frame: the document head (favicons, share card, theme, fonts),
// the header (the ball mark and the "Strap" wordmark, Docs, Source) and the
// footer, shared by the homepage and every docs page.
import { identity } from '../identity'
import { html, raw, type Markup } from './html'
import { arrow } from './landing/parts'
import run from './run.json'

export const repository = run.repository
export { arrow }
export const siteTheme = '/site/theme.css'
const shareImage = `${identity.runSite}/site/share.jpg`

export const lockup = (size = 44) => html`<a class="site-lockup" href="/"><img src="${identity.mark}" alt="" width="${size}" height="${size}"><span>${identity.product}</span></a>`
const links = (current?: 'docs') => html`<nav class="site-links" aria-label="Site"><a href="/docs"${current === 'docs' ? raw(' aria-current="page"') : ''}>Docs</a><a href="/contract">Contract</a><a href="${repository}">Source</a></nav>`

export const siteHeader = (current?: 'docs') => html`<header class="site-bar"><div class="site-bar-inner">${lockup()}${links(current)}</div></header>`
export const siteFooter = () => html`<footer class="site-foot"><div class="site-foot-inner"><p class="site-foot-brand">${lockup(40)}<span class="site-foot-line">Free, open source studio management</span></p><nav class="site-links" aria-label="Footer"><a href="/docs">Docs</a><a href="/contract">Contract</a><a href="${repository}">Source</a><a href="${repository}/blob/main/LICENSE">MIT licensed</a></nav></div></footer>`

/** One complete static page: the site theme, the compiled site stylesheet and the share card. */
export function sitePage(title: string, description: string, styles: string[], body: Markup, script = '', preload: Markup | string = ''): string {
  return '<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="theme-color" content="#FFFFFF">`
    + html`<meta property="og:type" content="website"><meta property="og:site_name" content="${identity.product}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="${shareImage}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`
    + html`<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">`
    + html`<link rel="preload" href="/fonts/playfair-display/playfair-display-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous"><link rel="preload" href="/fonts/figtree/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous">${preload}`
    + html`<link rel="stylesheet" href="${identity.fonts}"><link rel="stylesheet" href="${siteTheme}">${styles.map(href => html`<link rel="stylesheet" href="${href}">`)}</head><body><a class="skip" href="#main">Skip to content</a>${body}${script ? raw(`<script>${script}</script>`) : ''}</body></html>`.value
}

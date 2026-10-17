// The run site's frame: the document head, the header (mark, Docs, Contract, Source) and
// the footer, shared by the homepage and every docs page.
import { identity } from '../identity'
import { html, raw, type Markup } from './html'
import run from './run.json'

export const repository = run.repository
export const arrow = raw('<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>')

const lockup = html`<a class="site-lockup" href="/"><img src="${identity.mark}" alt="" width="28" height="28"><span>${identity.product}</span></a>`
const links = (current?: 'docs') => html`<nav class="site-links" aria-label="Site"><a href="/docs"${current === 'docs' ? raw(' aria-current="page"') : ''}>Docs</a><a href="/contract">Contract</a><a href="${repository}">Source</a></nav>`

export const siteHeader = (current?: 'docs') => html`<header class="site-bar"><div class="site-bar-inner">${lockup}${links(current)}</div></header>`
export const siteFooter = () => html`<footer class="site-foot"><div class="site-foot-inner"><p class="site-foot-brand">${lockup}<span class="site-foot-line">Free and open source, MIT licensed.</span></p>${links()}</div></footer>`

/** One complete static page: Strap's theme, shared components and the compiled site stylesheet. */
export function sitePage(title: string, description: string, styles: string[], body: Markup, script = ''): string {
  return '<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="theme-color" content="#FBF9F5"><link rel="icon" href="${identity.mark}"><link rel="preload" href="/fonts/urbanist/urbanist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous"><link rel="stylesheet" href="${identity.theme}"><link rel="stylesheet" href="/brand/strap.css">${styles.map(href => html`<link rel="stylesheet" href="${href}">`)}</head><body><a class="skip" href="#main">Skip to content</a>${body}${script ? raw(`<script>${script}</script>`) : ''}</body></html>`.value
}

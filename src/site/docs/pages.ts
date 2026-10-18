// The docs on the run site, in the landing's look: /docs (every guide, by
// section) and /docs/<slug> (one guide with the section list and its contents).
import '../styles/site.css'
import '../styles/docs.css'
import { html, raw, type Markup } from '../html'
import { arrow, repository, siteFooter, siteHeader } from '../shell'
import { docPages, docSections, renderDoc, type DocPage } from './content'

export const docsTitle = (page?: DocPage) => page ? `${page.title} · Strap docs` : 'Strap docs'
export const docsDescription = (page?: DocPage) => page?.summary ?? 'How to run your studio on Strap: classes and the waitlist, packs and payments, people, moving in, and backups.'

/** Unhides each code block's Copy button and copies its text; the pages read the same without it. */
export const copyScript = "document.querySelectorAll('.docs-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.closest('.docs-code').querySelector('code').textContent);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"

const sectionNav = (label: string, current?: string) => html`<nav class="docs-nav" aria-label="${label}">${docSections.map(section => html`<p class="docs-nav-title">${section.title}</p><ul>${section.pages.map(page => html`<li><a href="/docs/${page.slug}"${page.slug === current ? raw(' aria-current="page"') : ''}>${page.title}</a></li>`)}</ul>`)}</nav>`

const frame = (main: Markup, current?: string, toc?: Markup) => html`${siteHeader('docs')}<div class="docs wrap">
  <aside class="docs-side">${sectionNav('Docs', current)}</aside>
  <details class="docs-menu"><summary>All guides</summary>${sectionNav('Docs menu', current)}</details>
  <main id="main" class="docs-main">${main}</main>
  ${toc ?? ''}
</div>${siteFooter()}`

export function docsIndex(): Markup {
  const start = docPages[0]
  return frame(html`<header class="docs-intro"><div><p class="eyebrow docs-eyebrow"><span class="dot" aria-hidden="true"></span>Owner guides</p><h1>Strap docs</h1><p class="docs-lede">Everything you need to run your studio on Strap, from the first week of classes to moving your members in and keeping a backup.</p></div>
    <a class="card docs-start" href="/docs/${start.slug}"><span class="docs-start-label"><span class="dot" aria-hidden="true"></span>Start here</span><b>${start.title} ${arrow}</b><span>${start.summary}</span></a></header>
    ${docSections.map(section => html`<section class="docs-group"><h2>${section.title}</h2><ul class="docs-cards">${section.pages.map(page => html`<li><a class="docs-card card" href="/docs/${page.slug}"><b>${page.title}</b><span>${page.summary}</span></a></li>`)}</ul></section>`)}`)
}

export function docsArticle(page: DocPage): Markup {
  const { html: body, toc } = renderDoc(page)
  const at = docPages.indexOf(page), previous = docPages[at - 1], next = docPages[at + 1]
  const contents = toc.length > 1 ? html`<aside class="docs-toc"><p class="docs-toc-title">On this page</p><ol>${toc.map(item => html`<li><a href="#${item.id}">${item.text}</a></li>`)}</ol></aside>` : undefined
  return frame(html`<article class="docs-article"><p class="eyebrow docs-eyebrow"><span class="dot" aria-hidden="true"></span>${page.section}</p><h1>${page.title}</h1><p class="docs-lede">${page.summary}</p><div class="docs-body">${raw(body)}</div></article>
    <nav class="docs-pager" aria-label="More guides">${previous ? html`<a class="docs-card card prev" href="/docs/${previous.slug}"><span>Previous</span><b>${previous.title}</b></a>` : raw('<span></span>')}${next ? html`<a class="docs-card card next" href="/docs/${next.slug}"><span>Next</span><b>${next.title}</b></a>` : ''}</nav>
    <p class="docs-source"><a href="${repository}/blob/main/docs/${page.file}">View this guide's Markdown</a></p>`, page.slug, contents)
}

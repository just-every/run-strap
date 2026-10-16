/// <reference types="vite/client" />
// The docs, read from the repository's Markdown when `rer build --site` builds
// the run site: docs/site.json orders the pages, docs/*.md are their bodies.
// Rendering happens at build time only; the pages ship as static HTML.
import { Marked } from 'marked'
import manifest from '../../../docs/site.json'
import { escape } from '../html'
import { repository } from '../shell'

export interface DocPage { slug: string; file: string; title: string; summary: string; section: string }
export interface RenderedDoc { html: string; toc: { id: string; text: string }[] }

const sources = import.meta.glob('../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = (file: string) => {
  const text = sources[`../../../docs/${file}`]
  if (typeof text !== 'string') throw new Error(`docs/site.json names docs/${file}, which does not exist.`)
  return text
}

export const docPages: DocPage[] = manifest.sections.flatMap(section => section.pages.map(page => ({ ...page, section: section.title })))
export const docSections = manifest.sections.map(section => ({ title: section.title, pages: docPages.filter(page => page.section === section.title) }))
for (const path of Object.keys(sources)) {
  const file = path.split('/').pop()!
  if (!docPages.some(page => page.file === file) && !manifest.githubOnly.some(entry => entry.file === file)) throw new Error(`docs/${file} is neither a docs page nor listed as GitHub-only in docs/site.json.`)
}

const languages: Record<string, string> = { sh: 'Shell', bash: 'Shell', json: 'JSON', csv: 'CSV', ts: 'TypeScript', js: 'JavaScript', text: 'Text' }
const slugify = (text: string) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')

// A relative link to another docs page becomes its /docs path; one to any
// other repository file opens it on GitHub.
function link(href: string, from: DocPage): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href
  const [path, hash = ''] = href.split('#')
  const parts = ['docs', ...path.split('/')].reduce<string[]>((out, part) => part === '..' ? out.slice(0, -1) : part === '.' || !part ? out : [...out, part], [])
  const target = parts.join('/')
  const page = docPages.find(p => `docs/${p.file}` === target)
  if (page) return `/docs/${page.slug}${hash ? `#${hash}` : ''}`
  if (target.startsWith('docs/') && target.endsWith('.md') && !manifest.githubOnly.some(entry => `docs/${entry.file}` === target)) throw new Error(`docs/${from.file} links ${href}, which is not a docs page.`)
  return `${repository}/blob/main/${target}${hash ? `#${hash}` : ''}`
}

export function renderDoc(page: DocPage): RenderedDoc {
  const toc: RenderedDoc['toc'] = []
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        // The page title comes from docs/site.json; a Markdown title is for GitHub.
        if (depth === 1) return ''
        const inner = this.parser.parseInline(tokens), id = slugify(inner)
        if (depth === 2) toc.push({ id, text: inner.replace(/<[^>]+>/g, '') })
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`
      },
      code({ text, lang }) {
        const language = (lang ?? '').trim().split(/\s+/)[0].toLowerCase()
        return `<div class="docs-code"><div class="docs-code-head"><span>${escape(languages[language] ?? (language.toUpperCase() || 'Code'))}</span><button type="button" class="docs-copy" hidden>Copy</button></div><pre><code>${escape(text.replace(/\n$/, ''))}</code></pre></div>\n`
      },
      html({ text }) { return escape(text) },
      link({ href, title, tokens }) { return `<a href="${escape(link(href, page))}"${title ? ` title="${escape(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>` },
      image({ href }) { throw new Error(`docs/${page.file} has an image (${href}); the docs publish text only.`) },
    },
  })
  const body = (marked.parse(source(page.file), { async: false }) as string)
    .replace(/<table>/g, '<div class="docs-table" role="region" tabindex="0" aria-label="Table"><table>').replace(/<\/table>/g, '</table></div>')
  return { html: body, toc }
}

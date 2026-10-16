// The run site `rer build --site` writes: the approved homepage, whose Run
// Strap opens /run; the Run page from Base; the docs built from the
// repository's Markdown; and the not-found page. Every Run page string and
// command is in run.json; nothing here reads installation data.
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { copyScript, docsArticle, docsDescription, docsIndex, docsTitle } from './docs/pages'
import { docPages } from './docs/content'
import { landing, landingDescription, landingTitle } from './landing'
import { sitePage } from './shell'
import run from './run.json'

export function sitePages({ styles }: SiteContext): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: sitePage(landingTitle, landingDescription, styles, landing) },
      { path: '/run', html: runPageHtml(identity, data) },
      { path: '/docs', html: sitePage(docsTitle(), docsDescription(), styles, docsIndex()) },
      ...docPages.map(page => ({ path: `/docs/${page.slug}`, html: sitePage(docsTitle(page), docsDescription(page), styles, docsArticle(page), copyScript) })),
      { path: '/404', html: siteNotFoundHtml(identity, data) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand'],
  }
}

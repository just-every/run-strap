// The run site `rer build --site` writes: the approved homepage, whose Run
// Strap opens /run; the Run page from Base; the docs built from the
// repository's Markdown; and the not-found page. Every Run page string and
// command is in run.json; nothing here reads installation data. Base's pages
// read the site's tokens (/site/theme.css) and the entryway's floor as their art.
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { copyScript, docsArticle, docsDescription, docsIndex, docsTitle } from './docs/pages'
import { docPages } from './docs/content'
import { landing, landingDescription, landingPreload, landingTitle } from './landing'
import { sitePage, siteTheme } from './shell'
import run from './run.json'

const site = { ...identity, theme: siteTheme }

export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: sitePage(landingTitle, landingDescription, styles, landing, '', landingPreload) },
      { path: '/run', html: runPageHtml(site, data, contract) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(site, data, contract) }] : []),
      { path: '/docs', html: sitePage(docsTitle(), docsDescription(), styles, docsIndex()) },
      ...docPages.map(page => ({ path: `/docs/${page.slug}`, html: sitePage(docsTitle(page), docsDescription(page), styles, docsArticle(page), copyScript) })),
      { path: '/404', html: siteNotFoundHtml(site, data, contract) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'site', 'favicon.ico', 'apple-touch-icon.png'],
  }
}

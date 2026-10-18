// Small pieces every homepage section uses: a section's eyebrow and heading, the
// painted plates as responsive <picture>s, and the inline icons (drawn, never a
// font glyph, since the self-hosted faces carry no arrows or checks).
import { html, raw, type Markup } from '../html'

const svg = (body: string, cls = 'ico', box = '0 0 24 24') => raw(`<svg class="${cls}" viewBox="${box}" aria-hidden="true">${body}</svg>`)
const line = (d: string) => `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</g>`

export const icon = {
  person: svg('<circle cx="12" cy="7.5" r="4.5" fill="currentColor"/><path d="M3.5 21.5c.6-5 4-7.8 8.5-7.8s7.9 2.8 8.5 7.8z" fill="currentColor"/>'),
  calendar: svg(line('<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>')),
  group: svg('<circle cx="12" cy="6.8" r="3.6" fill="currentColor"/><circle cx="4.9" cy="8.6" r="2.7" fill="currentColor"/><circle cx="19.1" cy="8.6" r="2.7" fill="currentColor"/><path d="M5.6 20.5c.4-4.4 2.9-7.1 6.4-7.1s6 2.7 6.4 7.1z" fill="currentColor"/><path d="M.6 19.5c.2-3.4 1.8-5.6 4.4-5.6.8 0 1.5.2 2.1.5-1.4 1.3-2.2 3-2.5 5.1zM23.4 19.5c-.2-3.4-1.8-5.6-4.4-5.6-.8 0-1.5.2-2.1.5 1.4 1.3 2.2 3 2.5 5.1z" fill="currentColor"/>'),
  swap: svg(line('<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/>')),
  bars: svg('<rect x="3.5" y="11" width="4" height="10" rx="1" fill="currentColor"/><rect x="10" y="4" width="4" height="17" rx="1" fill="currentColor"/><rect x="16.5" y="13" width="4" height="8" rx="1" fill="currentColor"/>'),
  card: svg(line('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>')),
  ticket: svg(line('<path d="M3 6.5h18v3.2a2.3 2.3 0 0 0 0 4.6v3.2H3v-3.2a2.3 2.3 0 0 0 0-4.6z"/>')),
  bank: svg(line('<path d="M3 9.5 12 4l9 5.5M4.5 20.5h15M6.5 11v7M10.2 11v7M13.8 11v7M17.5 11v7"/>')),
  chevron: svg(line('<path d="M15 5l-7 7 7 7"/>')),
}

/** A check mark in the seed's green; `circle` sets it white on a filled green disc. */
export const check = (circle = false) => circle
  ? svg('<circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M7 12.4l3.2 3.2L17.2 8.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', 'tick tick-disc')
  : svg('<path d="M4.5 12.5l4.6 4.6L19.5 6.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>', 'tick')

/** The arrow inside text and buttons ("Run Strap →", "→ offered"). */
export const arrow = svg(line('<path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5"/>'), 'arr')

export const avatar = (initials: string, tone: 'sea' | 'grey' = 'sea') => html`<span class="av av-${tone}" aria-hidden="true">${initials}</span>`

/** A section's stage-and-date eyebrow with its plum dot, and its heading. */
export const heading = (id: string, eyebrow: Markup | string, title: Markup | string, level: 'h2' = 'h2') =>
  html`<p class="eyebrow"><span class="dot" aria-hidden="true"></span><span>${eyebrow}</span></p>${raw(`<${level} id="${id}">`)}${title}${raw(`</${level}>`)}`

/** One painted plate: AVIF and WebP at three widths, with an optional phone crop. */
export function painting(name: string, alt: string, opts: { widths: number[]; sizes?: string; eager?: boolean; height: number; width: number; phone?: { name: string; widths: number[]; media: string } }): Markup {
  const set = (n: string, ws: number[], type: string) => ws.map(w => `/site/${n}-${w}.${type} ${w}w`).join(', ')
  const sizes = opts.sizes ?? '100vw'
  const phone = opts.phone ? html`<source type="image/avif" media="${opts.phone.media}" srcset="${set(opts.phone.name, opts.phone.widths, 'avif')}" sizes="100vw"><source type="image/webp" media="${opts.phone.media}" srcset="${set(opts.phone.name, opts.phone.widths, 'webp')}" sizes="100vw">` : ''
  const largest = opts.widths[opts.widths.length - 1]
  return html`<picture>${phone}<source type="image/avif" srcset="${set(name, opts.widths, 'avif')}" sizes="${sizes}"><source type="image/webp" srcset="${set(name, opts.widths, 'webp')}" sizes="${sizes}"><img src="/site/${name}-${largest}.webp" alt="${alt}" width="${opts.width}" height="${opts.height}"${opts.eager ? raw(' fetchpriority="high"') : raw(' loading="lazy" decoding="async"')}></picture>`
}

// 11 Closing: "See you at 6 am." over the studio entryway before sunrise (the
// plate with its painted headline, buttons and footer removed).
import { html } from '../html'
import { arrow, painting } from './parts'

export const closing = html`<section class="closing" aria-labelledby="closing-title">
  <div class="closing-art">${painting('closing', 'Larkhill\'s entryway at 6 am: the glass door onto a pre-dawn street, white cubbies of rolled mats, towels and bottles over an oak bench, and a wall clock at six.', { widths: [768, 1152, 1536], width: 1536, height: 1024, phone: { name: 'closing-phone', widths: [640, 1000], media: '(max-width: 760px)' } })}</div>
  <div class="closing-copy">
    <h2 id="closing-title">See you at 6 am.</h2>
    <p class="closing-sub">100% free and open source.</p>
    <p class="actions"><a class="btn" href="/run"><span>Run Strap</span>${arrow}</a><a class="text-link" href="/docs">Read the docs</a></p>
  </div>
</section>`

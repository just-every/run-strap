// The closing band: a berry mat rolled out across the page, its end rolled at
// the right, carrying one white card with the page's two actions.
import { html } from '../html'
import { arrow } from '../shell'

export const closing = html`<section class="closing wrap" id="run"><div class="closing-mat mat roll-end"><div class="closing-card card">
  <h2>Try it beside what you have.</h2>
  <p>Run Strap on your own computer in two commands.</p>
  <p class="actions"><a class="btn btn-lg" href="/run">Run Strap${arrow}</a><a class="text-link" href="/docs">Read the docs</a></p>
</div></div></section>`

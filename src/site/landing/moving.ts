// 10 Moving in: the Mindbody import rehearsal, and Strap's one-line start in a
// terminal (the start line and one plain comment, nothing else).
import { html } from '../html'
import { check, heading } from './parts'
import run from '../run.json'

// At 390 the line breaks only before the repository, never inside it.
const start = run.clone, cut = start.lastIndexOf(' ') + 1

const rows: { text: string; wait?: boolean }[] = [
  { text: 'Clients · 1,846 · 300 active members' },
  { text: 'Memberships with autopay · 209 · renewal dates kept' },
  { text: 'Class packs · 64 · 391 sessions left · $8,412.00 matched' },
  { text: 'Signed waivers · 1,412 PDFs · linked to members' },
  { text: 'Saved cards · 195 · moved to Stripe' },
  { text: 'Bank accounts · 14 · members asked to re-authorize', wait: true },
  { text: "Old autopay off · before Strap's first run" },
]

export const moving = html`<section class="band band-sea moving" aria-labelledby="moving-title"><div class="wrap moving-grid">
  <div class="moving-copy">
    ${heading('moving-title', 'Moving in', 'Move between two autopay runs.')}
    <p class="lede lede-lg">Strap reads your Mindbody exports, moves saved cards through Stripe and checks the old autopay is off before its first run. WellnessLiving, Vagaro, Momence, Arketa and PushPress too.</p>
    <div class="terminal" role="group" aria-label="Start Strap on your computer"><p class="terminal-dots" aria-hidden="true"><i></i><i></i><i></i></p>
      <pre><code><span class="prompt" aria-hidden="true">$ </span>${start.slice(0, cut)}<span class="nobr">${start.slice(cut)}</span>
<span class="comment"># clones, installs and starts Strap on your computer</span></code></pre></div>
  </div>
  <article class="card import-card"><h3>Mindbody import · rehearsal</h3>
    <ul>${rows.map(r => html`<li>${r.wait ? html`<span class="amber-dot" aria-label="Waiting"></span>` : check(true)}<span>${r.text}</span></li>`)}</ul>
    <p class="import-actions"><span class="btn btn-sm">Approve cutover</span></p></article>
</div></section>`

// 01 Hero: Larkhill's barre room at dusk (the approved plate, its painted header
// and copy removed), the promise, and six records the page follows later on.
import { html, type Markup } from '../html'
import { arrow, check, icon, painting } from './parts'

const cards: { icon: Markup; tone?: 'plum'; body: Markup }[] = [
  { icon: icon.person, tone: 'plum', body: html`<b>Ana Patel</b> · usually Tue and Thu 6 am · no visit in 3 weeks` },
  { icon: icon.calendar, body: html`${arrow} offered Thu Oct 22 · 7:00 pm Barre · booked ${check()}` },
  { icon: icon.group, body: html`<b>Monthly Unlimited</b> · both studios · Mon Oct 19 at 12South ${check()}` },
  { icon: icon.swap, body: html`<b>Sub</b> · Ray Chen for Kim Lowe · Wed Oct 21 6:00 pm · 11 notified` },
  { icon: icon.bars, body: html`<b>Kim Lowe</b> · Oct 1–15 · 22 classes × $55 = $1,210` },
  { icon: icon.card, body: html`<b>Autopay</b> Sun Nov 1 · 212 memberships · scheduled` },
]

export const hero = html`<section class="hero" aria-labelledby="hero-title">
  <div class="hero-art">${painting('hero', 'Six members at the barre in Larkhill Pilates + Yoga at dusk, the Nashville skyline in the arched windows behind them.', { widths: [768, 1152, 1536], eager: true, width: 1536, height: 464, phone: { name: 'hero-phone', widths: [640, 820], media: '(max-width: 760px)' } })}</div>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <h1 id="hero-title">Full classes. <span>Members who stay.</span></h1>
      <p class="hero-sub">Strap sells and auto-renews memberships, fills classes through your branded app, recovers failed payments, and spots members drifting away and books them back in.</p>
      <p class="hero-alt">100% free, open source alternative to <strong>Mindbody</strong>, <strong>WellnessLiving</strong> and <strong>Vagaro</strong></p>
      <p class="actions"><a class="btn" href="/run"><span>Run Strap</span>${arrow}</a><a class="text-link" href="https://demo.run-strap.com/">Try the demo</a><a class="text-link" href="/docs">Read the docs</a></p>
    </div>
    <ul class="hero-cards" aria-label="This fortnight at Larkhill">${cards.map(c => html`<li class="hero-card${c.tone ? ' accent' : ''}"><span class="hero-card-ico${c.tone ? ' plum' : ''}">${c.icon}</span><p>${c.body}</p></li>`)}</ul>
  </div>
</section>`

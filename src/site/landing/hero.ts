// The hero: the headline block, and the upright berry mat carrying the
// waitlist's 1-2-3 (Ava cancels, Leo gets the spot, Leo checks in). Every
// string in the drawing is a real label or sample value from the app.
import { html } from '../html'
import { arrow } from '../shell'

const steps = [
  { title: 'Ava cancels', initials: 'AB', name: 'Ava Brooks', pill: 'Cancelled', style: 'outline', note: '8 credits remaining' },
  { title: 'Leo gets the spot', initials: 'LH', name: 'Leo Haddad', pill: 'Booked', style: 'tint' },
  { title: 'Leo checks in', initials: 'LH', name: 'Leo Haddad', pill: 'Checked in', style: 'solid' },
]

const step = (s: typeof steps[number], i: number) => html`<li class="step card">
  <p class="step-head"><span class="numeral" aria-hidden="true">${i + 1}</span><span class="step-title">${s.title}</span></p>
  <p class="step-class">Morning Flow</p>
  <p class="step-person"><span class="initials" aria-hidden="true">${s.initials}</span><span class="step-name">${s.name}</span><span class="pill ${s.style}">${s.pill}</span></p>
  ${s.note ? html`<p class="step-note">${s.note}</p>` : ''}
</li>`

export const hero = html`<section class="hero wrap" id="top">
  <div class="hero-copy">
    <h1>Studio classes, handled.</h1>
    <p class="hero-sub">Publish the week, give members class credits, and let the waitlist fill cancellations.</p>
    <p class="hero-free">100% free, open source alternative to <strong>Mindbody</strong>, <strong>TeamUp</strong> and <strong>Momence</strong></p>
    <p class="actions"><a class="btn btn-lg" href="/run">Run Strap${arrow}</a><a class="btn btn-lg" href="https://demo.run-strap.com/">Try the demo</a><a class="text-link" href="/docs">Read the docs</a></p>
    <p class="hero-small">Free and open source, MIT licensed.</p>
  </div>
  <figure class="hero-drawing" aria-label="Ava cancels her Morning Flow booking and gets her credit back; Leo, first on the waitlist, gets the spot and checks in.">
    <div class="hero-mat mat roll-top"><ol class="steps">${steps.map(step)}</ol></div>
  </figure>
</section>`

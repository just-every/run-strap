// 03 Intro to member: Jess Alvarez's three weeks from a website lead to Monthly
// Unlimited, and the studio's branded member app on her phone.
import { html } from '../html'
import { arrow, check, heading, icon } from './parts'

const steps = [
  { day: 'Sat Sep 26', line: 'Lead from your website booking widget' },
  { day: 'Mon Sep 28', line: 'Bought Intro 3 weeks · $59.00 · waiver signed' },
  { day: 'Mon Sep 28', line: 'Welcome email · what to bring, grip socks' },
  { day: 'Thu Oct 15', line: '9 classes so far · offer sent' },
]
const terms = [['Today · Oct 19–31 prorated', '$79.26'], ['Then on the 1st', '$189.00'], ['Next charge', 'Sun Nov 1'], ['Autopay', 'Visa •• 7316']]

const phone = html`<figure class="phone" aria-label="Larkhill's member app: join Monthly Unlimited for $79.26 today">
  <div class="phone-screen">
    <p class="phone-status"><span>9:41</span><span class="phone-island" aria-hidden="true"></span><span class="phone-signal" aria-hidden="true"><i></i><i></i><i></i><i></i></span></p>
    <p class="phone-nav">${icon.chevron}<span>Larkhill Pilates + Yoga</span></p>
    <div class="phone-body">
      <p class="phone-title">Monthly Unlimited</p>
      <p class="phone-sub">$189 / month · both studios</p>
      <dl class="phone-terms">${terms.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      <p class="phone-agree"><span class="box" aria-hidden="true">${check()}</span>I agree to the membership terms</p>
      <p class="phone-join">Join · pay $79.26</p>
    </div>
    <span class="phone-home" aria-hidden="true"></span>
  </div>
</figure>`

export const intro = html`<section class="band intro" aria-labelledby="intro-title"><div class="wrap intro-grid">
  <div class="intro-copy">
    ${heading('intro-title', html`Intro to member · Sep 28 ${arrow} Oct 19`, 'From intro to member in three weeks.')}
    <p class="lede lede-lg">Strap sends the welcome, counts her visits and offers the right plan before her intro ends. Nothing renews until she says yes.</p>
  </div>
  <div class="intro-stage">
    <article class="card timeline-card"><header class="tl-head"><span class="av av-sea av-lg" aria-hidden="true">JA</span><h3>Jess Alvarez · Intro 3 weeks $59</h3></header>
      <ol class="timeline">${steps.map(s => html`<li><b>${s.day}</b><span>${s.line}</span></li>`)}<li class="done"><b>Mon Oct 19</b><span>Joined Monthly Unlimited $189 ${check()}</span></li></ol>
    </article>
    ${phone}
    <p class="card toast"><span class="toast-tick">${check(true)}</span><span><b>Mon Oct 19 · 5:30 pm</b><span>Mat Flow at 12South · booked</span></span></p>
  </div>
</div></section>`

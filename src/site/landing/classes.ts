// 05 Classes: the reformer room as an architect's floor plan, every reformer
// booked by name (two ClassPass, one from the waitlist), and the cards that say
// how Reformer 7 was filled. The plan is HTML and CSS: landscape from 761 px,
// portrait under it (mirror on top, 1–6 down the left, 7–12 down the right).
import { html } from '../html'
import { avatar, check, heading, icon } from './parts'

const reformers: { name: string; tag?: 'ClassPass' | 'from waitlist' }[] = [
  { name: 'Erin M.' }, { name: 'Kayla B.' }, { name: 'Rosa D.' }, { name: 'Mel S.', tag: 'ClassPass' }, { name: 'Jamie T.' }, { name: 'Priya S.' },
  { name: 'Dana K.', tag: 'from waitlist' }, { name: 'Hannah W.' }, { name: 'Lou P.', tag: 'ClassPass' }, { name: 'Grace L.' }, { name: 'Nina F.' }, { name: 'Tasha R.' },
]
const tone = (tag?: string) => tag === 'ClassPass' ? ' classpass' : tag ? ' waitlist' : ''
const plant = html`<span class="plant" aria-hidden="true"><svg viewBox="0 0 40 40"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => html`<path transform="rotate(${a} 20 20)" d="M20 20C17 14 18 6 20 2c2 4 3 12 0 18z"/>`)}<circle cx="20" cy="20" r="2.4"/></g></svg></span>`

const plan = html`<figure class="card plan" aria-labelledby="plan-title">
  <figcaption id="plan-title" class="plan-title"><b>Reformer Flow</b> · Tue Oct 20 · 6:00 am · 12 of 12 booked<span class="plan-by"> · Mia Torres</span></figcaption>
  <div class="room">
    <p class="mirror"><span>Mirror</span></p>
    ${plant}${plant}
    <p class="teacher"><span class="teacher-mat" aria-hidden="true"><i></i></span><span class="teacher-name">Mia Torres</span></p>
    <ol class="reformers">${reformers.map((r, i) => html`<li class="ref${tone(r.tag)}"><span class="ref-label"><b>${i + 1}</b> ${r.name}</span><span class="ref-frame" aria-hidden="true"><i class="ref-bar"></i><i class="ref-strap"></i><i class="ref-strap"></i><i class="ref-carriage"></i><i class="ref-foot"></i></span>${r.tag ? html`<span class="ref-tag">${r.tag}</span>` : ''}</li>`)}</ol>
    <p class="door"><svg viewBox="0 0 80 80" aria-hidden="true"><path class="door-gap" d="M0 78.5H78"/><path d="M2.5 78V8"/><path d="M2.5 8A70 70 0 0 1 72.5 78"/></svg><span>Door</span></p>
  </div>
</figure>`

export const classes = html`<section class="band band-blue classes" aria-labelledby="classes-title"><div class="wrap">
  ${heading('classes-title', 'Classes · Tue Oct 20 · 6:00 am', 'Twelve reformers, booked by name.')}
  <p class="lede">Members pick their reformer in your app. ClassPass and the waitlist share the same twelve.</p>
  <div class="classes-grid">
    ${plan}
    <div class="side-cards">
      <article class="card side-card"><header class="side-head"><span class="side-ico">${icon.calendar}</span><h3>Reformer 7 <span>· freed 8:40 pm Mon</span></h3></header>
        <ul class="rows tight"><li>Ben Carter cancelled late · $15 fee</li><li>Offered to Dana Kim · claim by 9:40 pm</li><li class="ok">${check(true)}Claimed 8:52 pm · 1 credit used</li></ul></article>
      <article class="card side-card"><header class="side-head"><span class="side-ico">${icon.group}</span><h3>Waitlist <span>· 3 waiting</span></h3></header>
        <ol class="rows tight queue">${['Owen Kerr', 'Sasha Lin', 'Ben Ruiz'].map((n, i) => html`<li><span class="num">${i + 1}</span>${n}</li>`)}</ol></article>
      <article class="card side-card"><header class="side-head"><span class="side-ico">${icon.ticket}</span><h3>ClassPass <span>· 2 of 2 spots booked · same 12 reformers</span></h3></header>
        <ul class="rows tight queue">${[['MS', 'Mel S. · Reformer 4'], ['LP', 'Lou P. · Reformer 9']].map(([i, n]) => html`<li>${avatar(i)}${n}</li>`)}</ul></article>
    </div>
  </div>
</div></section>`

// 09 What came back: Ana's visits after the offer, October's member-success
// funnel, and the waitlist pattern that becomes a new 7:15 am class.
import { html } from '../html'
import { avatar, check, heading } from './parts'

const weeks: [string, number][] = [['Sep 28', 1], ['Oct 5', 0], ['Oct 12', 0], ['Oct 19', 1], ['Oct 26', 2]]
const visits = ['Thu Oct 22 · Barre 7:00 pm', 'Tue Oct 27 · Reformer Flow 6:00 pm · 12South', 'Thu Oct 29 · Barre 7:00 pm']
const funnel: [string, string][] = [['Drifting from their routine', '14'], ['Not contacted · 2 frozen · 1 opted out', '3'], ['Offered a class', '11'], ['Booked', '8'], ['Came back twice or more', '7'], ['Renewed Nov 1', '7 of 8']]
const pattern = ['Full with a waitlist · 8 of the last 8', 'Average waitlist · 4', 'Proposed · Tue and Thu 7:15 am Reformer Flow · Mia Torres free', 'Approved by Tessa M. · Thu Nov 5', 'First class Tue Nov 10 · 23 waitlisted members told']

export const back = html`<section class="band back" aria-labelledby="back-title"><div class="wrap">
  <div class="center-head">${heading('back-title', 'What came back · Thu Nov 5', "Ana's back on Thursdays.")}<p class="lede">Strap follows every offer through visits and renewals, and turns the waitlists behind it into a new class.</p></div>
  <div class="back-grid">
    <article class="card back-card"><header class="card-head start">${avatar('AP')}<h3>Ana Patel · after the offer</h3></header>
      <ol class="weeks" aria-label="Visits per week">${weeks.map(([w, n]) => html`<li class="${n ? 'on' : ''}"><span>${w}</span><i aria-hidden="true"></i><b>${n}</b></li>`)}</ol>
      <ul class="rows checks">${visits.map(v => html`<li><span>${v}</span>${check()}</li>`)}</ul>
      <p class="done-pill">${check(true)}Renewed Sun Nov 1 · $189.00</p></article>
    <article class="card back-card"><h3 class="card-title">Member success · October</h3>
      <ul class="rows counts">${funnel.map(([k, v]) => html`<li><span>${k}</span><b>${v}</b></li>`)}</ul>
      <p class="card-note">11 members is too few to compare with members not contacted</p></article>
    <article class="card back-card"><h3 class="card-title">6:00 am Reformer Flow · Tue and Thu</h3>
      <ul class="rows">${pattern.map(p => html`<li>${p}</li>`)}</ul>
      <p class="done-pill">${check(true)}New class published</p></article>
  </div>
</div></section>`

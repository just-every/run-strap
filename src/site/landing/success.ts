// 02 Member success: why Ana Patel stopped, the consented text offering only
// open classes, and the booking at 11:42 am, joined by arrows (downward at 390).
import { html } from '../html'
import { arrow, avatar, check, heading } from './parts'

const why = ['Usual routine · Tue and Thu 6:00 am Reformer Flow', '41 visits since May · last visit Tue Sep 29', 'Waitlisted Thu Oct 1, Tue Oct 6, Thu Oct 8 · not promoted', 'Monthly Unlimited · not frozen · renews Sun Nov 1', 'Profile note Oct 2 · evenings work better now']
const booked = ['Barre · Thu Oct 22 · 7:00 pm', 'East Nashville · 3 spots left', 'Booked 11:42 am · on her Monthly Unlimited', 'Confirmation sent · push and email', 'Watching her visits and the Nov 1 renewal']
const joint = html`<span class="flow-arrow" aria-hidden="true">${arrow}</span>`

export const success = html`<section class="band band-sea success" aria-labelledby="success-title"><div class="wrap">
  ${heading('success-title', 'Member success · Mon Oct 19 · 10:05 am', 'Missed for three weeks. Booked by noon.')}
  <p class="lede">The member-success agent reads her bookings, explains the gap, offers classes that fit and books the one she picks.</p>
  <div class="flow">
    <article class="card flow-card"><header class="card-head"><h3>Why Ana Patel stopped</h3>${avatar('AP')}</header><ul class="rows">${why.map(r => html`<li>${r}</li>`)}</ul><p class="card-foot"><span class="pill pill-plum">No visit in 3 weeks</span></p></article>
    ${joint}
    <article class="card flow-card text-card"><header class="card-head"><h3>Text to Ana <span>· sent 10:05 am</span></h3></header>
      <div class="chat"><p class="bubble out">Hi Ana, we've missed you. Thu Oct 22, 7:00 pm Barre has 4 spots. Tue Oct 27, 6:00 pm Reformer Flow at 12South has 2 reformers. Want one?</p><p class="bubble in">Thursday please!</p><p class="chat-time">11:41 am</p></div>
      <p class="card-note">Only open classes she can book · texts 9 am–8 pm</p></article>
    ${joint}
    <article class="card flow-card"><header class="card-head"><h3>Booked</h3><span class="head-tick">${check(true)}</span></header><ul class="rows">${booked.map(r => html`<li>${r}</li>`)}</ul></article>
  </div>
</div></section>`

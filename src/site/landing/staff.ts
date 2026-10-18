// 06 Staff: Kim Lowe's cover request filled by 7:40, and the Oct 1–15 pay run
// to the cent (22 × $55 = $1,210.00 is the hero's card).
import { html } from '../html'
import { avatar, check, heading } from './parts'

const pay: [string, string, string, string][] = [['Kim Lowe', '22', '$55', '$1,210.00'], ['Ray Chen', '16', '$50', '$800.00'], ['Mia Torres', '14', '$50', '$700.00'], ['Owen Park', '12', '$45', '$540.00'], ['4 more instructors', '33', '', '$1,500.00']]
const totals: [string, string][] = [['Classes', '$4,750.00'], ['Retail commissions', '$86.40'], ['Tips', '$142.00']]

export const staff = html`<section class="band band-sea staff" aria-labelledby="staff-title"><div class="wrap">
  <div class="split-head"><div>${heading('staff-title', 'Staff · Wed Oct 21', 'Covered by 7:40. Paid to the cent.')}</div><p class="lede">Strap finds a qualified sub, tells the class, and hands payroll exact pay for every instructor.</p></div>
  <div class="staff-grid">
    <article class="card staff-card"><h3 class="card-title">Cover request · Reformer Flow <span>· Wed Oct 21 · 6:00 pm · 12South</span></h3>
      <ol class="cover">
        <li><b>7:12 am</b> · Kim Lowe asked for cover</li>
        <li class="open"><span class="cover-label">Qualified and free</span><span class="chips"><span class="chip">${avatar('RC')}Ray Chen</span><span class="chip">${avatar('OP')}Owen Park</span><span class="chip off">${avatar('MT', 'grey')}Mia Torres · teaching 5:45 pm</span></span></li>
        <li><b>7:31 am</b> · Ray Chen accepted</li>
        <li><b>7:40 am</b> · approved by Tessa M. · roster and pay moved</li>
        <li><b>7:41 am</b> · 11 booked members told · push 8 · text 2 · email 1</li>
      </ol>
      <p class="done-pill">${check(true)}Sub · Ray Chen for Kim Lowe</p>
    </article>
    <article class="card staff-card"><h3 class="card-title">Pay run · Oct 1–15 · approved Wed Oct 21</h3>
      <div class="table-scroll"><table class="pay"><thead><tr><th scope="col">Instructor</th><th scope="col">Classes</th><th scope="col">Rate</th><th scope="col">Pay</th></tr></thead>
        <tbody>${pay.map(([n, c, r, p]) => html`<tr><th scope="row">${n}</th><td>${c}</td><td>${r}</td><td>${p}</td></tr>`)}</tbody>
        <tbody class="sums">${totals.map(([n, v]) => html`<tr><th scope="row" colspan="3">${n}</th><td>${v}</td></tr>`)}</tbody>
        <tfoot><tr><th scope="row" colspan="3">Total</th><td>$4,978.40</td></tr></tfoot></table></div>
      <p class="card-note">6 W-2 · 2 1099 · sent to Gusto ${check()} · pay date Fri Oct 23</p>
    </article>
  </div>
</div></section>`

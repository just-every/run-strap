// 07 Front desk: the 9:30 rush on the desk tablet (roster and cart), with a flat
// still life of the retail rail beside the copy: a wire rack of grip socks
// (toe and heel drawn) and two rolled mats, in sea-glass and plum.
import { html, raw } from '../html'
import { avatar, check, heading } from './parts'

const roster: { i: string; name: string; line: string; pill?: string }[] = [
  { i: 'SR', name: 'Sam Reyes', line: 'waiver signed · checked in' },
  { i: 'LO', name: 'Lena Ortiz', line: 'walk-in · waiver signed on the desk tablet · drop-in $28' },
  { i: 'AB', name: 'Ava Brooks', line: 'Wellhub · eligible · checked in' },
  { i: 'ME', name: 'Mark Ellis', line: 'checked in', pill: 'Last credit in pack' },
  { i: 'TG', name: 'Tom Grady', line: 'late cancel · $15 fee charged' },
]

const sock = (x: number, fill: string, deep: string) => `<g transform="translate(${x} 0)"><path d="M10 8h22v46q0 5 5 7l22 6q11 3 11 13 0 10-12 10H28Q10 90 10 72z" fill="${fill}"/><rect x="8" y="4" width="26" height="10" rx="3" fill="${deep}"/><path d="M10 72q0 18 18 18h6q-14-6-12-24z" fill="${deep}"/><path d="M58 67q12 3 12 13 0 10-12 10h-4q6-11 4-23z" fill="${deep}"/><g fill="#fff" opacity=".75"><circle cx="30" cy="84" r="1.6"/><circle cx="38" cy="86" r="1.6"/><circle cx="46" cy="86" r="1.6"/><circle cx="34" cy="79" r="1.6"/><circle cx="42" cy="80" r="1.6"/><circle cx="50" cy="81" r="1.6"/></g></g>`
const stillLife = raw(`<svg class="still" viewBox="0 0 460 300" role="img" aria-label="A wire rack of grip socks and two rolled mats">
  <ellipse cx="230" cy="286" rx="220" ry="9" fill="#EEF1F3"/>
  <g transform="translate(22 190)">${sock(0, '#9CCFC6', '#5E9F96')}${sock(76, '#7B2964', '#561845')}${sock(152, '#9CCFC6', '#5E9F96')}</g>
  <g fill="none" stroke="#B9C2CC" stroke-width="3" stroke-linecap="round"><path d="M14 210h236M14 282V196M250 282V196M14 246h236"/><path d="M14 196h236"/></g>
  <rect x="300" y="64" width="62" height="216" rx="8" fill="#9CCFC6"/><rect x="300" y="64" width="62" height="216" rx="8" fill="none" stroke="#7DB5AC" stroke-width="2"/><ellipse cx="331" cy="68" rx="31" ry="9" fill="#BFE3DC"/><ellipse cx="331" cy="68" rx="13" ry="4" fill="#7DB5AC"/>
  <rect x="376" y="64" width="62" height="216" rx="8" fill="#7B2964"/><rect x="376" y="64" width="62" height="216" rx="8" fill="none" stroke="#5B1A49" stroke-width="2"/><ellipse cx="407" cy="68" rx="31" ry="9" fill="#9A4A82"/><ellipse cx="407" cy="68" rx="13" ry="4" fill="#5B1A49"/>
</svg>`)

export const desk = html`<section class="band desk" aria-labelledby="desk-title"><div class="wrap desk-grid">
  <div class="desk-copy">
    ${heading('desk-title', 'Front desk · Wed Oct 21 · 9:30 am', 'The 9:30 rush, at one desk.')}
    <p class="lede lede-lg">Check-ins, waivers, walk-ins, fees and retail on the desk tablet, while the class fills.</p>
    ${stillLife}
  </div>
  <figure class="tablet" aria-label="The desk tablet: today's 9:30 roster and Lena Ortiz's cart">
    <div class="tablet-screen">
      <article class="pane roster"><h3>Mat Yoga 9:30 · Leah Grant</h3><p class="pane-sub">18 of 20 here · 6 on Zoom</p>
        <ul>${roster.map(r => html`<li>${avatar(r.i)}<span class="who"><b>${r.name}</b><span>${r.line}</span></span>${r.pill ? html`<span class="pill pill-amber">${r.pill}</span>` : check()}</li>`)}</ul></article>
      <article class="pane cart"><h3>Cart · Lena Ortiz</h3>
        <dl class="cart-lines"><div><dt>Grip socks ×2</dt><dd>$36.00</dd></div><div><dt>Tax 9.25%</dt><dd>$3.33</dd></div><div class="total"><dt>Total</dt><dd>$39.33</dd></div></dl>
        <p class="pay-btn">Tap to Pay</p><p class="cart-note">Receipt by email · stock updated</p>
        <p class="cart-dropin"><span>Drop-in $28.00 · paid at sign-in</span>${check()}</p></article>
    </div>
  </figure>
</div></section>`

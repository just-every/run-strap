// 08 Renewals: the page's one deep plum band. 212 memberships renew on Sun Nov 1;
// the stacked bar's columns are the counts (196fr / 12fr / 4fr in cards.css), and the two
// failures are followed to paid.
import { html } from '../html'
import { arrow, check, heading, icon } from './parts'

const runs: [string, string, number][] = [['paid', 'Paid', 196], ['ach', 'Payment pending', 12], ['declined', 'Unpaid · reminders drafted 6:05 am', 4]]

const steps = (items: [string, string][]) => html`<ol class="steps">${items.map(([tone, text]) => html`<li class="${tone}">${text}${tone === 'paid' ? html` ${check()}` : ''}</li>`)}</ol>`

export const autopay = html`<section class="band band-plum autopay" aria-labelledby="autopay-title"><div class="wrap">
  ${heading('autopay-title', html`Renewals · Sun Nov 1 ${arrow} Thu Nov 5`, 'The 1st, invoiced.')}
  <p class="lede">212 memberships renew at 6:00 am. Strap issues each invoice and renews access, then tracks every payment you record until it is paid.</p>
  <div class="autopay-grid">
    <article class="card pay-card run-card"><header class="pay-head"><span class="pay-ico">${icon.card}</span><span><h3>Renewals <span>· Sun Nov 1</span></h3><p class="pay-sub">212 memberships · $36,608.00</p></span></header>
      <p class="stack" role="img" aria-label="196 paid, 12 payments pending, 4 unpaid, of 212">${runs.map(([k]) => html`<i class="${k}"></i>`)}</p>
      <ul class="tally">${runs.map(([k, label, n]) => html`<li class="${k}"><span>${label}</span><b>${n}</b></li>`)}</ul>
      <p class="pay-total"><span>Paid by Thu Nov 5 · </span><span>211 of 212 · $36,419.00</span></p></article>
    <article class="card pay-card"><header class="pay-head"><span class="pay-ico bad">${icon.card}</span><span><h3>Priya Shah · $189</h3><span class="pill pill-red">Unpaid</span></span></header>
      ${steps([['bad', '6:00 am · invoice issued · $189 due'], ['wait', '6:05 am · reminder drafted · owner approves the text'], ['paid', '2:14 pm · payment recorded · paid']])}</article>
    <article class="card pay-card"><header class="pay-head"><span class="pay-ico bad">${icon.bank}</span><span><h3>Chris Lee · $189</h3><span class="pill pill-red">Unpaid</span></span></header>
      ${steps([['bad', 'Wed Nov 4 · still unpaid · $189 owed'], ['wait', 'Reminder reviewed and approved by the owner'], ['paid', 'Thu Nov 5 · 9:41 am · payment recorded at the desk']])}
      <p class="card-note">Balance and receipts stay in Strap</p></article>
  </div>
</div></section>`

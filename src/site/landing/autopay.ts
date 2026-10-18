// 08 Autopay: the page's one deep plum band. 212 memberships renew on Sun Nov 1;
// the stacked bar's columns are the counts (196fr / 12fr / 4fr in cards.css), and the two
// failures are followed to paid.
import { html } from '../html'
import { arrow, check, heading, icon } from './parts'

const runs: [string, string, number][] = [['paid', 'Cards paid', 196], ['ach', 'Bank (ACH) pending', 12], ['declined', 'Declined · update links sent 6:05 am', 4]]

const steps = (items: [string, string][]) => html`<ol class="steps">${items.map(([tone, text]) => html`<li class="${tone}">${text}${tone === 'paid' ? html` ${check()}` : ''}</li>`)}</ol>`

export const autopay = html`<section class="band band-plum autopay" aria-labelledby="autopay-title"><div class="wrap">
  ${heading('autopay-title', html`Autopay · Sun Nov 1 ${arrow} Thu Nov 5`, 'The 1st, collected.')}
  <p class="lede">212 memberships renew at 6:00 am. When a card is declined or a bank payment bounces, Strap explains why, keeps access fair and gets it paid.</p>
  <div class="autopay-grid">
    <article class="card pay-card run-card"><header class="pay-head"><span class="pay-ico">${icon.card}</span><span><h3>Autopay <span>· Sun Nov 1</span></h3><p class="pay-sub">212 memberships · $36,608.00</p></span></header>
      <p class="stack" role="img" aria-label="196 cards paid, 12 bank payments pending, 4 declined, of 212">${runs.map(([k]) => html`<i class="${k}"></i>`)}</p>
      <ul class="tally">${runs.map(([k, label, n]) => html`<li class="${k}"><span>${label}</span><b>${n}</b></li>`)}</ul>
      <p class="pay-total"><span>Paid by Thu Nov 5 · </span><span>211 of 212 · $36,419.00</span></p></article>
    <article class="card pay-card"><header class="pay-head"><span class="pay-ico bad">${icon.card}</span><span><h3>Card declined · Priya Shah · $189</h3><span class="pill pill-red">Declined</span></span></header>
      ${steps([['bad', '6:00 am · insufficient funds'], ['wait', '6:05 am · update link sent · text and email'], ['paid', '2:14 pm · new card · paid']])}</article>
    <article class="card pay-card"><header class="pay-head"><span class="pay-ico bad">${icon.bank}</span><span><h3>ACH returned · Chris Lee · $189</h3><span class="pill pill-red">Returned</span></span></header>
      ${steps([['bad', 'Wed Nov 4 · returned R01 · insufficient funds'], ['wait', 'No automatic retry on a returned debit'], ['wait', 'Access kept in grace to Mon Nov 9'], ['paid', 'Thu Nov 5 · 9:41 am · paid by card at the desk']])}
      <p class="card-note">Explained from Stripe events by the agent</p></article>
  </div>
</div></section>`

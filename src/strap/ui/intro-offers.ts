import { body, emptyLine, field, form, h, hidden, owner, panel, person, personSelect, select, statusPill, textarea } from './shared';
import { money, when } from './format';

const path = '/app/packs#intro-offers';
const request = () => hidden('requestId',crypto.randomUUID());
const channel = () => select('channel','Sale channel',[['desk','At the desk'],['phone','Phone'],['inbox','Email or inbox']],'desk');
export function introOffersPanel(s: any, chosen = '') {
  const staff = owner(s), data = s.intros ?? {offers:[],identities:[],links:[],previews:[],sales:[]};
  const memberChoices = (s.people ?? []).filter((p: any) => p.role === 'member' && p.active).map((p: any) => [p.id,p.name]);
  const setup = staff ? `<details class="more"><summary>Configure an intro offer</summary>${body(form('intro.offer.save',path,
    field('name','Offer name','','text','required maxlength="80"')
    + `<div class="row2">${field('days','Duration in elapsed days','14','number','required min="1" max="366"')}${field('credits','Included visits','3','number','required min="1" max="10000"')}</div>`
    + field('amount','Intro price','','text','required inputmode="decimal"')
    + select('eligibility','Client eligibility',[['new','New clients only'],['returning','Returning clients only']],'new')
    + field('returnAfterDays','Days since all access and attended visits ended (returning only)','90','number','min="1" max="3660"')
    + select('limit','Lifetime intro limit across offers',[['person','One per verified person'],['household','One per verified household']],'person')
    + textarea('eligibleServices','Intro eligible services (one per line; blank = all)','','maxlength="16000"'), 'Save intro offer'))}</details>`
    + `<details class="more"><summary>Verify intro eligibility identity</summary>${body('<p>Check the person and household before selling. Links only restrict intro eligibility; they grant no account, booking, payer or contact access. Links are retained and cannot be removed here. Record a concise verification reason without sensitive documents.</p>'
    +form('intro.identity.verify',path,personSelect(s,chosen)
      +select('samePersonAsId','Another account for the same person',[['','No linked account'],...memberChoices],'','')
      +select('householdWithId','Another verified person in the same household',[['','No other household member'],...memberChoices],'','')
      +textarea('reason','Identity verification reason','','required maxlength="500"')
      +'<label class="check"><input type="checkbox" name="householdChecked" value="true" required> I checked this person’s identity and household.</label>'+request()+channel(),'Record verified identity'))}</details>` : '';
  const offers = data.offers.filter((o: any) => o.active).map((o: any) => `<article class="record" data-intro-offer="${h(o.id)}"><h3>${h(o.name)}</h3><p>${o.credits} visits · ${o.days} elapsed days from purchase · <strong>${money(o.amountCents)}</strong></p><p>${h(o.eligibleServices.join(', ') || 'All classes')}. ${o.eligibility === 'new' ? 'New clients only.' : `Returning clients: at least ${o.returnAfterDays} days since access and attended visits ended.`} One intro per ${h(o.limit)} across all offers.</p><p>The price is added to the member’s studio balance. No payment is collected. No automatic renewal.</p>`
    +form('intro.preview',path,hidden('offerId',o.id)+(staff ? personSelect(s,chosen)+channel()+`<details><summary>Eligibility exception (owner only)</summary>${textarea('exceptionReason','Eligibility exception reason','','maxlength="500"')}</details>` : '')+request(),'Preview intro purchase')
    +(staff ? form('intro.offer.close',path,hidden('id',o.id),'Close this offer','quiet') : '')+'</article>').join('');
  const previews = data.previews.filter((p: any) => p.status === 'preview' && (!chosen || p.personId === chosen)).map((p: any) => {
    const expired = p.validUntil <= new Date().toISOString();
    return `<article class="record" data-intro-preview="${h(p.id)}"><h3>${h(p.offerName)} · exact purchase preview</h3>`
      +(staff ? `<p>${h(person(s,p.personId))}</p>` : '')
      +`<p>${p.credits} visits · ${p.days} elapsed days starting when confirmed. <strong>${money(p.amountCents)} added to the studio balance once.</strong> No payment is collected.</p><p>Class starts must be before the exact expiry shown on your purchase receipt. Ordinary service, waiver, capacity and cancellation rules apply. Unused visits expire. No automatic renewal; any recurring offer needs your separate acceptance.</p>`
      +(p.exceptionReason ? `<p>Owner-approved eligibility exception: ${h(p.exceptionReason)}</p>` : '')
      +`<p>Preview valid until ${when(s,p.validUntil)}. Eligibility is checked again on confirmation.</p>`
      +(expired ? '<p>Preview expired. Prepare a new one.</p>' : form('intro.purchase',path,hidden('id',p.id)+hidden('key',p.key)+request()+(staff ? channel() : '')+'<label class="check"><input type="checkbox" name="confirm" value="true" required> Confirm these exact intro terms and studio-balance charge.</label>','Confirm intro purchase'))+'</article>';
  }).join('');
  const sales = data.sales.filter((r: any) => !chosen || r.personId === chosen).map((r: any) => `<article class="record" data-intro-sale="${h(r.id)}"><h3>${h(r.offerName)} · ${statusPill(r.expiresAt > new Date().toISOString() ? 'active' : 'expired')}</h3>`
    +(staff ? `<p>${h(person(s,r.personId))}</p>` : '')+`<p>${r.credits} original visits · ${money(r.amountCents)} original charge. Starts ${when(s,r.startsAt)}; expires ${when(s,r.expiresAt)} (exclusive). See Class packs and Credit history for available visits and usage.</p>`
    +(staff && r.exceptionReason ? `<p>Eligibility exception: ${h(r.exceptionReason)}. Retained in staff history under the price right.</p>` : '')
    +'<p>Expiry alone creates no membership or invoice. <a href="#freezes">Review a separately offered recurring invoice agreement</a> to accept or decline; any agreement states its exact price, interval and first due date. No card or bank collection is authorized.</p></article>').join('');
  return panel('Intro offers',body('<p>Choose a short introduction to the studio. Identity and household eligibility are checked privately by the owner before purchase.</p>'+setup+(offers || emptyLine('No intro offers are currently available.'))+previews+sales),{id:'intro-offers',icon:'card'});
}

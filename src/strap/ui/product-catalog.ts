import { body, cell, emptyLine, field, form, h, hidden, owner, panel, personSelect, rows, select, table, textarea } from './shared';
import { money } from './format';

export function catalogTerms(version: any) {
  if (!version) return '';
  return `<dl class="facts" data-catalog-version="${h(version.id)}"><dt>Catalog purchase</dt><dd>${h(version.name)} · version ${h(version.version)} · ${h(version.code)}</dd><dt>Original price</dt><dd>${money(version.amountCents)} USD · ${['fixed-term','monthly','annual'].includes(version.kind) ? 'Unlimited visits' : h(version.credits)+' credits'}</dd><dt>Original services</dt><dd>${h(version.eligibleServices.join(', ') || 'All services')}</dd><dt>Original locations</dt><dd>${h(version.locationNames.map((l: any)=>l.name).join(', '))}</dd><dt>Product type</dt><dd>${h(version.kind)}</dd>${version.kind === 'intro' ? `<dt>Intro eligibility</dt><dd>${h(version.eligibility)} clients · once per ${h(version.limit)}${version.returnAfterDays ? ' · '+h(version.returnAfterDays)+' elapsed days away' : ''}; verified identity required</dd>` : ''}<dt>Validity</dt><dd>${version.intervalMonths ? 'One initial term of '+h(version.intervalMonths)+' calendar month(s), then native studio invoices only after personal acceptance. No card or bank collection.' : h(version.validDays)+' elapsed days from '+(version.kind === 'intro' ? 'purchase' : 'preparation')+'. No automatic renewal.'}</dd></dl>`;
}

function fields(s: any, version: any = {}) {
  const places=rows(s,'locations');
  return select('productKind','Product type',[['finite-pack','Finite class pack'],['drop-in','Single drop-in'],['fixed-term','Fixed-term unlimited membership'],['intro','Intro offer'],['monthly','Monthly unlimited studio invoices'],['annual','Annual unlimited studio invoices']],version.kind ?? 'finite-pack') + field('name','Product name',version.name ?? '', 'text','required maxlength="80"')
    + `<div class="row2">${field('amount','Price in USD',version.amountCents === undefined ? '' : (version.amountCents/100).toFixed(2),'text','required inputmode="decimal"')}${field('credits','Class credits',version.credits ?? 10,'number','required min="0" max="10000" step="1"')}</div>`
    + '<p>Drop-ins grant one credit. Fixed-term, monthly and annual memberships grant unlimited visits. Monthly and annual sales require personal acceptance of recurring studio invoices; no card or bank is charged. The credit field applies to finite packs and intros.</p>'
    + field('validDays','Valid for elapsed days',version.validDays ?? 90,'number','required min="1" max="3660" step="1"')
    + `<details><summary>Intro eligibility</summary>${select('eligibility','Eligible clients',[['new','New clients'],['returning','Returning clients']],version.eligibility ?? 'new')}${select('limit','Intro limit',[['person','Once per verified person'],['household','Once per verified household']],version.limit ?? 'person')}${field('returnAfterDays','Returning client gap in elapsed days',version.returnAfterDays ?? 90,'number','min="1" max="3660"')}</details>`
    + textarea('eligibleServices','Eligible services (one per line; blank means all services)',version.eligibleServices?.join('\n') ?? '','maxlength="16000"')
    + select('locationId','Sale location',places.map(l=>[l.id,l.name]),version.locationId ?? 'studio')
    + `<fieldset class="days"><legend>Eligible locations (none ticked = sale location)</legend>${places.map(l=>`<label class="check"><input name="lc_${h(l.id)}" type="checkbox" value="true"${version.eligibleLocations?.includes(l.id) ? ' checked' : ''}> ${h(l.name)}</label>`).join('')}</fieldset>`;
}

export function productCatalogPanel(s: any) {
  if (!owner(s)) return '';
  const catalog=s.productCatalog ?? {products:[],versions:[]};
  const entries=catalog.products.map((product: any)=>{
    const current=catalog.versions.find((v: any)=>v.id===product.versionId);
    return `<article class="panel-body" data-product="${h(product.id)}"><h3>${h(current.name)} · ${product.active ? 'Published' : 'Retired'}</h3>${catalogTerms(current)}`
      + (product.active ? form('catalog.retire','/app/studio#product-catalog',hidden('id',product.id)+hidden('revision',product.revision),'Retire product','quiet') : '')
      + `<details><summary>Publish a new version of ${h(current.name)}</summary>${form('catalog.publish','/app/studio#product-catalog',hidden('code',product.code)+hidden('revision',product.revision)+fields(s,current),'Publish new version')}</details>`
      + `<details><summary>Published version history</summary><div class="table-wrap">${table(['Version','Name','Price in USD','Credits','Services','Locations'],catalog.versions.filter((v: any)=>v.productId===product.id).map((v: any)=>`<tr>${cell('Version',h(v.version))}${cell('Name',h(v.name))}${cell('Price in USD',money(v.amountCents))}${cell('Credits',h(v.credits))}${cell('Services',h(v.eligibleServices.join(', ') || 'All services'))}${cell('Locations',h(v.locationNames.map((l: any)=>l.name).join(', ')))}</tr>`).join(''))}</div></details></article>`;
  }).join('');
  return panel('Product catalog',body('<p>Publish personal class packs, single drop-ins, fixed-term unlimited memberships, monthly and annual native studio invoices and verified intro offers. Each new version keeps its own USD price, credits, services and locations. Sold terms stay in purchase receipts. Changes and retirement invalidate unapproved drafts.</p>')
    + (entries || emptyLine('No catalog packs published yet.'))
    + (s.studio ? body(`<details><summary>Publish a finite pack</summary>${form('catalog.publish','/app/studio#product-catalog',field('code','Stable product code','','text','required maxlength="40" pattern="[a-z][a-z0-9-]*"')+hidden('revision',0)+fields(s),'Publish product')}</details>`) : emptyLine('Save studio settings before publishing a product.')), {id:'product-catalog',icon:'card'});
}

export function catalogPurchasePanel(s: any, chosen: string) {
  if (!owner(s)) return '';
  const catalog=s.productCatalog, active=catalog?.products.filter((p: any)=>p.active && !['intro','monthly','annual'].includes(catalog.versions.find((v: any)=>v.id===p.versionId)?.kind)) ?? [];
  return panel('Prepare a catalog pack',body('<p>Select published terms for a personal sale. Review the exact price and expiry before owner approval. No payment is collected.</p>'
    + (active.length ? form('pack.prepare','/app/packs',personSelect(s,chosen)+select('catalogVersionId','Published catalog pack',[['','Choose a product'],...active.map((p: any)=>{const v=catalog.versions.find((v: any)=>v.id===p.versionId);return [v.id,`${v.name} · version ${v.version} · ${money(v.amountCents)} USD · ${v.kind === 'fixed-term' ? 'Unlimited visits' : v.credits+' credits'}`];})]),'Review catalog pack') : '<p>No active catalog packs. Publish one in Studio settings.</p>')
    + '<a href="/app/studio#product-catalog">Manage product catalog in Settings</a>'),{id:'catalog-purchase',icon:'card'});
}


/** Existing catalog terms and form components serve the member and the scoped staff door. */
export function catalogCheckoutPanel(s: any, chosen = '', back='/app/packs#catalog-checkout') {
  const mine=s.actor.role==='member',isOwner=owner(s);
  if (!mine && !isOwner && !(s.staffPermissions ?? []).includes('membership-sale')) return '';
  const versions=s.catalogStore?.versions ?? [],purchases=(s.catalogPurchases ?? []).filter((p: any)=>(!chosen || p.personId===chosen) && (mine || p.createdBy===s.actor.id));
  const reviews=purchases.filter((p: any)=>p.status!=='sold').map((p: any)=>`<article data-catalog-purchase="${h(p.id)}"><h3>${h(p.catalogVersion.name)} · ${p.status==='accepted' ? 'Personally accepted; staff confirmation required' : 'Exact purchase review'}</h3>${catalogTerms(p.catalogVersion)}<p>${h(p.consent)}</p><p>Review expires ${h(p.validUntil)}.</p>`
    +(p.validUntil<=new Date().toISOString() ? '<p>Review expired. Prepare a fresh purchase.</p>' : mine && p.status==='preview' || !mine && p.status==='accepted' ? form(mine?'catalog.purchase.confirm':'catalog.purchase.confirm.staff',back,hidden('id',p.id)+hidden('key',p.key)+hidden('requestId',crypto.randomUUID())+'<label class="check"><input type="checkbox" name="confirm" value="true" required> '+(mine?'I personally accept these exact terms and studio-balance charges.':'Confirm this personally accepted sale.')+'</label>','Confirm catalog purchase') : '<p>The member signs in on their own device and opens My packs to review and personally accept. Staff cannot accept for them.</p>')+'</article>').join('');
  const pick=versions.length ? form(mine?'catalog.purchase.preview':'catalog.purchase.preview.staff',back,(!mine ? (chosen ? hidden('personId',chosen) : personSelect(s)) : '')+hidden('requestId',crypto.randomUUID())+(!mine ? hidden('channel','desk') : '')+select('catalogVersionId','Catalog product',[['','Choose a product'],...versions.map((v: any)=>[v.id,`${v.name} · ${v.kind} · ${money(v.amountCents)} USD`])]),'Review catalog purchase') : '';
  return panel(mine?'Buy from the catalog':'Catalog sales',body('<p>Personal purchases add the exact USD price to the studio balance. No payment is collected. Review the full service, location, expiration and renewal terms before accepting.</p>'+pick+reviews),{id:'catalog-checkout',icon:'card'});
}

import { body, cell, emptyLine, field, form, h, hidden, owner, panel, personSelect, rows, select, table, textarea } from './shared';
import { money } from './format';

export function catalogTerms(version: any) {
  if (!version) return '';
  return `<dl class="facts" data-catalog-version="${h(version.id)}"><dt>Catalog purchase</dt><dd>${h(version.name)} · version ${h(version.version)} · ${h(version.code)}</dd><dt>Original price</dt><dd>${money(version.amountCents)} USD · ${h(version.credits)} credits</dd><dt>Original services</dt><dd>${h(version.eligibleServices.join(', ') || 'All services')}</dd><dt>Original locations</dt><dd>${h(version.locationNames.map((l: any)=>l.name).join(', '))}</dd><dt>Validity</dt><dd>${h(version.validDays)} elapsed days from preparation; exact expiry shown below. No automatic renewal.</dd></dl>`;
}

function fields(s: any, version: any = {}) {
  const places=rows(s,'locations');
  return field('name','Product name',version.name ?? '', 'text','required maxlength="80"')
    + `<div class="row2">${field('amount','Price in USD',version.amountCents === undefined ? '' : (version.amountCents/100).toFixed(2),'text','required inputmode="decimal"')}${field('credits','Class credits',version.credits ?? 10,'number','required min="1" max="10000" step="1"')}</div>`
    + field('validDays','Valid for elapsed days',version.validDays ?? 90,'number','required min="1" max="3660" step="1"')
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
  return panel('Product catalog',body('<p>Publish finite class packs for personal sales. Each new version keeps its own USD price, credits, services and locations. Sold terms stay in purchase receipts. Changes and retirement invalidate unapproved drafts.</p>')
    + (entries || emptyLine('No catalog packs published yet.'))
    + (s.studio ? body(`<details><summary>Publish a finite pack</summary>${form('catalog.publish','/app/studio#product-catalog',field('code','Stable product code','','text','required maxlength="40" pattern="[a-z][a-z0-9-]*"')+hidden('revision',0)+fields(s),'Publish product')}</details>`) : emptyLine('Save studio settings before publishing a product.')), {id:'product-catalog',icon:'card'});
}

export function catalogPurchasePanel(s: any, chosen: string) {
  if (!owner(s)) return '';
  const catalog=s.productCatalog, active=catalog?.products.filter((p: any)=>p.active) ?? [];
  return panel('Prepare a catalog pack',body('<p>Select published terms for a personal sale. Review the exact price and expiry before owner approval. No payment is collected.</p>'
    + (active.length ? form('pack.prepare','/app/packs',personSelect(s,chosen)+select('catalogVersionId','Published catalog pack',[['','Choose a product'],...active.map((p: any)=>{const v=catalog.versions.find((v: any)=>v.id===p.versionId);return [v.id,`${v.name} · version ${v.version} · ${money(v.amountCents)} USD · ${v.credits} credits`];})]),'Review catalog pack') : '<p>No active catalog packs. Publish one in Studio settings.</p>')
    + '<a href="/app/studio#product-catalog">Manage product catalog in Settings</a>'),{id:'catalog-purchase',icon:'card'});
}

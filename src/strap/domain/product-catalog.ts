import { humanOwner, insist, integer, list, now, record, text, type State, type RecordData } from './types';
import type { Transaction } from './store';
import { locations, packPlaces } from './locations';
import { householdOf } from './households';
import { saveIntroOffer, closeIntroOffer } from './intro-offers';

export const catalogKinds = ['finite-pack','drop-in','fixed-term','intro','monthly','annual'] as const;

/** Published terms are append-only. The product only selects the version offered for a new sale. */
export function publishProduct(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const code = text(input.code,'code',40);
  insist(/^[a-z][a-z0-9-]*$/.test(code),'invalid_product_code');
  const productId = 'product-catalog:'+code, prior = tx.state.records.get(productId);
  insist(!prior || prior.kind === 'productCatalog','product_conflict',409);
  const revision = integer(input.revision,'revision',0,Number.MAX_SAFE_INTEGER);
  insist(revision === (prior?.data.revision ?? 0),'catalog_changed',409);
  insist(input.currency === undefined || input.currency === 'USD','catalog_requires_usd');
  const places = packPlaces(tx.state,input);
  insist(Array.isArray(places.eligibleLocations),'catalog_requires_selected_locations');
  insist(places.eligibleLocations.includes(places.locationId),'catalog_sale_location_not_eligible');
  const available = locations(tx.state);
  insist(available.some(l=>l.id===places.locationId),'studio_settings_required',409);
  const services = input.eligibleServices;
  insist(Array.isArray(services) && services.length <= 100,'invalid_eligibleServices');
  const labels = services.map(s=>text(s,'eligibleServices',160).replace(/\s+/g,' '));
  const eligibleServices = [...new Map(labels.map(s=>[s.toLowerCase(),s])).values()];
  const kind = input.productKind ?? 'finite-pack';
  insist(catalogKinds.includes(kind as typeof catalogKinds[number]),'invalid_product_kind');
  const previous = prior ? record(tx.state,prior.data.versionId,'productCatalogVersion') : null;
  insist(!previous || previous.kind === kind,'catalog_product_kind_immutable',409);
  const credits = ['fixed-term','monthly','annual'].includes(String(kind)) ? 0 : kind === 'drop-in' ? 1 : integer(input.credits,'credits',1,10_000);
  const validDays = integer(input.validDays,'validDays',1,kind === 'intro' ? 366 : 3660);
  const version = (prior?.data.version ?? 0)+1, at = now();
  const versionId = productId+':v'+version;
  const intro = kind === 'intro' ? saveIntroOffer(tx,{...input,days:validDays,credits,eligibleServices}) : null;
  if (intro) tx.put('introOffer',{...intro,catalogVersionId:versionId,...places});
  if (previous?.introOfferId) closeIntroOffer(tx,{id:previous.introOfferId});
  const published = {id:versionId,productId,code,version,name:text(input.name,'name',80),kind,currency:'USD',
    amountCents:integer(input.amountCents,'amountCents',0,100_000_000),credits,validDays,eligibleServices,...places,
    ...(intro ? {introOfferId:intro.id,eligibility:intro.eligibility,limit:intro.limit,returnAfterDays:intro.returnAfterDays} : {}),
    locationNames:places.eligibleLocations.map(id=>({id,name:available.find(l=>l.id===id)!.name})),
    ...(['monthly','annual'].includes(String(kind)) ? {intervalMonths:kind === 'monthly' ? 1 : 12,timeZone:available.find(l=>l.id===places.locationId)!.timeZone} : {}),
    publishedAt:at,publishedBy:tx.who.id};
  tx.put('productCatalogVersion',published);
  tx.put('productCatalog',{id:productId,code,version,versionId:published.id,revision:revision+1,active:true,updatedAt:at,updatedBy:tx.who.id});
  return published;
}

export function retireProduct(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const product = record(tx.state,input.id,'productCatalog');
  insist(integer(input.revision,'revision',1,Number.MAX_SAFE_INTEGER) === product.revision,'catalog_changed',409);
  insist(product.active,'catalog_retired',409);
  const version = record(tx.state,product.versionId,'productCatalogVersion');
  if (version.introOfferId) closeIntroOffer(tx,{id:version.introOfferId});
  const retired = {...product,active:false,revision:product.revision+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('productCatalog',retired); return retired;
}

export function currentProductVersion(state: State, versionId: unknown) {
  const version = record(state,versionId,'productCatalogVersion');
  const product = record(state,version.productId,'productCatalog');
  insist(product.active,'catalog_retired',409);
  insist(product.versionId === version.id,'catalog_changed',409);
  return version;
}

export function personalCatalogMember(state: State, member: {id:string;role:string}) {
  insist(member.role === 'member' && !householdOf(state,member.id),'catalog_personal_sale_required',409);
}

export function catalogPackInput(tx: Transaction, input: Record<string,unknown>) {
  insist(Object.keys(input).every(k=>['personId','catalogVersionId'].includes(k)),'catalog_terms_cannot_be_overridden');
  const version = currentProductVersion(tx.state,input.catalogVersionId);
  insist(!version.intervalMonths,'catalog_recurring_requires_personal_checkout',409);
  insist(version.kind !== 'intro','catalog_intro_requires_eligibility_review',409);
  return {version:structuredClone(version),terms:{personId:input.personId,...(version.kind === 'fixed-term' ? {} : {credits:version.credits}),amountCents:version.amountCents,
    ...(version.kind === 'fixed-term' ? {kind:'unlimited',planName:version.name} : {}),eligibleServices:version.eligibleServices,locationId:version.locationId,eligibleLocations:version.eligibleLocations,
    expiresAt:new Date(Date.now()+version.validDays*86_400_000).toISOString()}};
}

export const productCatalog = (state: State) => ({products:list(state,'productCatalog'),versions:list(state,'productCatalogVersion')});
export function catalogDraftStale(state: State, draft: RecordData) {
  if (!draft.catalogVersion) return false;
  const product = state.records.get(draft.catalogVersion.productId);
  return product?.kind !== 'productCatalog' || !product.data.active || product.data.versionId !== draft.catalogVersion.id;
}

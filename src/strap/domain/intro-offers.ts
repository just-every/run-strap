import { currentProductVersion, personalCatalogMember } from './product-catalog';
import { humanOwner, id, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent } from './pack-credits';
import { contractNotice } from './contract-billing';
import { settleUnpaid } from './desk';
import { promoteAll } from './bookings';
import { staffChannel } from './staff-actions';

const day = 86_400_000;
const identityOf = (state: State, personId: string) => state.records.get(`intro-identity:${personId}`)?.data;
const member = (state: State, personId: unknown, active = true) => {
  const p = person(state,personId,active); insist(p.role === 'member','member_required',403); return p;
};
function subject(tx: Transaction, input: Record<string,unknown>) {
  if (tx.who.role === 'member') {
    insist(input.personId === undefined || input.personId === tx.who.personId,'intro_not_found',404);
    return member(tx.state,tx.who.personId);
  }
  humanOwner(tx.who); return member(tx.state,input.personId);
}
/** Eligibility links are additive, owner-verified facts, never sign-in or payer authority. */
export function verifyIntroIdentity(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const p = member(tx.state,input.personId), reason = text(input.reason,'reason',500);
  insist(input.householdChecked === true,'household_verification_required');
  const links = [['person',input.samePersonAsId],['household',input.householdWithId]] as const;
  for (const [kind,otherId] of links) if (otherId) {
    const other = member(tx.state,otherId,false); insist(other.id !== p.id,'cannot_link_self');
    insist(identityOf(tx.state,other.id),'linked_identity_not_verified',409);
    tx.put('introIdentityLink',{id:id(),personId:p.id,otherPersonId:other.id,kind,reason,verifiedBy:tx.who.id,at:now()});
  }
  const previous = identityOf(tx.state,p.id);
  const verification = {id:`intro-identity:${p.id}`,personId:p.id,householdChecked:true,revision:(previous?.revision ?? 0)+1,reason,verifiedBy:tx.who.id,at:now()};
  tx.put('introIdentity',verification);
  tx.put('introIdentityEvent',{...verification,id:id()});
  return verification;
}
function component(state: State, personId: string, household = false) {
  const ids = new Set([personId]), links = list(state,'introIdentityLink').filter(r => household || r.kind === 'person');
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links) if (ids.has(link.personId) || ids.has(link.otherPersonId)) {
      for (const key of [link.personId,link.otherPersonId]) if (!ids.has(key)) {ids.add(key);changed=true;}
    }
  }
  return [...ids].sort();
}
export function saveIntroOffer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const eligibility = text(input.eligibility,'eligibility',20), limit = text(input.limit,'limit',20);
  insist(['new','returning'].includes(eligibility),'invalid_intro_eligibility');
  insist(['person','household'].includes(limit),'invalid_intro_limit');
  const eligibleServices = input.eligibleServices ?? [];
  insist(Array.isArray(eligibleServices) && eligibleServices.length <= 100,'invalid_eligibleServices');
  const services = [...new Set(eligibleServices.map(s => text(s,'eligibleServices',160).replace(/\s+/g,' ')))];
  const offer = {id:id(),name:text(input.name,'name',80),days:integer(input.days,'days',1,366),credits:integer(input.credits,'credits',1,10_000),
    amountCents:integer(input.amountCents,'amountCents',0,100_000_000),eligibility,limit,
    returnAfterDays:eligibility === 'returning' ? integer(input.returnAfterDays,'returnAfterDays',1,3660) : null,
    eligibleServices:services,active:true,createdAt:now(),createdBy:tx.who.id};
  tx.put('introOffer',offer); return offer;
}
export function closeIntroOffer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); const offer = record(tx.state,input.id,'introOffer');
  const closed = {...offer,active:false,closedAt:offer.closedAt ?? now()}; tx.put('introOffer',closed); return closed;
}
function facts(state: State, personId: string, offer: RecordData) {
  const persons = component(state,personId), household = component(state,personId,true);
  const packs = list(state,'pack').filter(p => persons.includes(p.personId));
  const bookings = list(state,'booking').filter(b => persons.includes(b.personId));
  const classes = list(state,'class').filter(c => bookings.some(b => b.classId === c.id));
  const limited = offer.limit === 'household' ? household : persons;
  const purchases = list(state,'introSale').filter(s => limited.includes(s.personId) || persons.includes(s.personId)
    || s.limit === 'household' && component(state,s.personId,true).some(p => household.includes(p)));
  return {people:household.map(key => member(state,key,false)),identities:household.map(key => identityOf(state,key)),
    links:list(state,'introIdentityLink').filter(l => household.includes(l.personId) || household.includes(l.otherPersonId)),persons,household,packs,bookings,classes,purchases};
}
function refusal(state: State, personId: string, offer: RecordData, at: string) {
  insist(identityOf(state,personId)?.householdChecked,'intro_identity_verification_required',409);
  const f = facts(state,personId,offer);
  if (f.purchases.length) return 'intro_already_used';
  const visits = f.bookings.filter(b => b.attendance === 'attended').map(b => f.classes.find(c => c.id === b.classId)?.start).filter(Boolean) as string[];
  if (offer.eligibility === 'new') return f.packs.length || visits.length ? 'intro_new_clients_only' : null;
  if (!f.packs.length && !visits.length) return 'intro_returning_clients_only';
  const cutoff = new Date(Date.parse(at)-offer.returnAfterDays*day).toISOString();
  return [...f.packs.map(p => p.expiresAt),...visits].some(at => at > cutoff) ? 'intro_return_gap_not_met' : null;
}
async function digest(value: unknown) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2,'0')).join('');
}
const basis = (state: State, personId: string, offer: RecordData) => digest({offer,facts:facts(state,personId,offer)});
const visibleSale = (r: RecordData) => {
  const {exceptionReason,eligibilityFailure,exceptionApprovedBy,...safe} = r; return safe;
};
export async function previewIntro(tx: Transaction, input: Record<string,unknown>) {
  const p = subject(tx,input), offer = record(tx.state,input.offerId,'introOffer');
  insist(offer.active,'intro_offer_closed',409);
  if (offer.catalogVersionId) { currentProductVersion(tx.state,offer.catalogVersionId); personalCatalogMember(tx.state,p); }
  const requestId = text(input.requestId,'requestId',100);
  const exceptionReason = input.exceptionReason ? text(input.exceptionReason,'exceptionReason',500) : null;
  insist(!exceptionReason || tx.who.role === 'owner','owner_required',403);
  const previous = list(tx.state,'introPreview').find(r => r.createdBy === tx.who.id && r.requestId === requestId);
  if (previous) {
    insist(previous.personId === p.id && previous.offerId === offer.id && previous.exceptionReason === exceptionReason,'intro_request_changed',409);
    return tx.who.role === 'owner' ? previous : visibleSale(previous);
  }
  const at = now(), failure = refusal(tx.state,p.id,offer,at);
  insist(!failure || exceptionReason,failure ?? 'intro_ineligible',409);
  insist(!exceptionReason || failure,'intro_exception_not_needed');
  const preview = {id:id(),personId:p.id,offerId:offer.id,offerName:offer.name,days:offer.days,credits:offer.credits,amountCents:offer.amountCents,
    ...(offer.catalogVersionId ? {catalogVersion:structuredClone(currentProductVersion(tx.state,offer.catalogVersionId))} : {}),
    eligibleServices:offer.eligibleServices,limit:offer.limit,exceptionReason,eligibilityFailure:failure,
    basis:await basis(tx.state,p.id,offer),status:'preview',createdAt:at,createdBy:tx.who.id,createdByRole:tx.who.role,requestId,
    validUntil:new Date(Date.parse(at)+15*60_000).toISOString(),collection:'studio-balance-only',renewsAutomatically:false};
  const result = {...preview,key:await digest(preview)};
  tx.put('introPreview',result); return tx.who.role === 'owner' ? result : visibleSale(result);
}
export async function purchaseIntro(tx: Transaction, input: Record<string,unknown>) {
  const preview = record(tx.state,input.id,'introPreview');
  if (tx.who.role === 'member') insist(preview.personId === tx.who.personId && preview.createdBy === tx.who.id,'intro_not_found',404);
  else {humanOwner(tx.who);insist(preview.createdBy === tx.who.id,'intro_not_found',404);}
  insist(input.key === preview.key && input.confirm === true,'intro_confirmation_required',409);
  // Staff exception previews are deliberately not actionable by a member.
  insist(!preview.exceptionReason || tx.who.role === 'owner','intro_not_found',404);
  const prior = list(tx.state,'introSale').find(r => r.previewId === preview.id);
  if (prior) return tx.who.role === 'owner' ? prior : visibleSale(prior);
  const p = member(tx.state,preview.personId), offer = record(tx.state,preview.offerId,'introOffer'), at = now();
  if (offer.catalogVersionId) { currentProductVersion(tx.state,offer.catalogVersionId); personalCatalogMember(tx.state,p); }
  insist(offer.active && preview.validUntil > at,'intro_preview_expired',409); tx.future(preview.validUntil);
  insist(preview.basis === await basis(tx.state,p.id,offer),'intro_eligibility_changed',409);
  const failure = refusal(tx.state,p.id,offer,at);
  insist(!failure || preview.exceptionReason && failure === preview.eligibilityFailure,failure ?? 'intro_ineligible',409);
  const saleId = id(), pack = {id:id(),personId:p.id,introSaleId:saleId,introOfferId:offer.id,eligibleServices:offer.eligibleServices,priorityBooking:false,
    entitlement:{kind:'credits',name:offer.name,visits:null,period:null,rollover:0,days:null,from:null,to:null,maxUpcoming:null},
    creditLedgerVersion:1,creditRevision:0,credits:offer.credits,remaining:0,amountCents:offer.amountCents,termStartAt:at,
    expiresAt:new Date(Date.parse(at)+offer.days*day).toISOString(),createdAt:at};
  const sale = {id:saleId,personId:p.id,offerId:offer.id,previewId:preview.id,packId:pack.id,offerName:offer.name,days:offer.days,credits:offer.credits,
    amountCents:offer.amountCents,limit:offer.limit,eligibleServices:offer.eligibleServices,startsAt:at,expiresAt:pack.expiresAt,
    exceptionReason:preview.exceptionReason,eligibilityFailure:failure,exceptionApprovedBy:preview.exceptionReason ? tx.who.id : null,
    purchasedBy:tx.who.id,channel:tx.who.role === 'owner' ? staffChannel(input) : 'member-self-service',createdAt:at};
  if (offer.catalogVersionId) Object.assign(pack,{catalogVersion:structuredClone(currentProductVersion(tx.state,offer.catalogVersionId)),purchaseExpiresAt:pack.expiresAt,purchaseAmountCents:pack.amountCents,locationId:offer.locationId,eligibleLocations:offer.eligibleLocations});
  tx.put('pack',pack); appendPackEvent(tx,pack,{type:'grant',credits:pack.credits});
  tx.put('introSale',sale); tx.put('introPreview',{...preview,status:'purchased',saleId:sale.id});
  tx.put('charge',{id:id(),personId:p.id,packId:pack.id,introSaleId:sale.id,...(offer.catalogVersionId ? {catalogVersionId:offer.catalogVersionId,locationId:offer.locationId} : {}),amountCents:offer.amountCents,kind:'intro',createdAt:at});
  contractNotice(tx,`intro-sale:${sale.id}`,p.id,'Intro offer purchased',`${offer.name}: ${offer.credits} visits, $${(offer.amountCents/100).toFixed(2)} added to your studio balance, valid from ${at} until ${pack.expiresAt} (exclusive). No payment is collected. The intro ends without renewal unless you separately accept exact recurring invoice terms.`);
  settleUnpaid(tx,record(tx.state,pack.id,'pack')); promoteAll(tx);
  return tx.who.role === 'owner' ? sale : visibleSale(sale);
}
export function introSnapshot(state: State, who: Actor) {
  const owner = who.role === 'owner', self = who.role === 'member';
  const own = (r: RecordData) => owner || self && r.personId === who.personId;
  return {offers:owner || self ? list(state,'introOffer').filter(o => owner || o.active) : [],
    identities:owner ? list(state,'introIdentity') : [],links:owner ? list(state,'introIdentityLink') : [],
    previews:list(state,'introPreview').filter(r => own(r) && (owner || r.createdBy === who.id && !r.exceptionReason)).map(r => owner ? r : visibleSale(r)),
    sales:list(state,'introSale').filter(own).map(r => owner ? r : visibleSale(r))};
}

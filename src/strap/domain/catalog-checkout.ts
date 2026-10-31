import { currentProductVersion, personalCatalogMember, productCatalog } from './product-catalog';
import { grantReviewedPack } from './money';
import { consentText, consentRetention, nextInvoiceAt, packTerms, contractNotice } from './contract-billing';
import { hasStaffRight, requireStaffRight } from './staff-rights';
import { staffChannel } from './staff-actions';
import { id, insist, list, now, person, record, text, type Actor, type State, type RecordData } from './types';
import type { Transaction } from './store';

const digest = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
const fingerprint = (tx: Transaction) => digest(text(tx.who.sessionId,'native_session',200));
const exposed = (p: RecordData) => { const {sessionFingerprint,...visible}=p; return visible; };
const staff = (who: Actor) => who.role !== 'member';
const staffVisible = (state: State, who: Actor, p: RecordData) => hasStaffRight(state,who,'membership-sale',p.personId,p.catalogVersion.locationId);

/** Resolve the saved member and sale location before any request replay. */
export function authorizeCatalogSale(tx: Transaction, input: Record<string,unknown>) {
  const preview = input.id ? record(tx.state,input.id,'catalogPurchase') : null;
  const version = preview?.catalogVersion ?? currentProductVersion(tx.state,input.catalogVersionId);
  requireStaffRight(tx.state,tx.who,'membership-sale',preview?.personId ?? input.personId,version.locationId);
  if (preview) insist(preview.createdBy === tx.who.id,'catalogPurchase_not_found',404);
}

export async function previewCatalogPurchase(tx: Transaction, input: Record<string,unknown>) {
  const isStaff = staff(tx.who);
  if (isStaff) authorizeCatalogSale(tx,input);
  else insist(input.personId === undefined || input.personId === tx.who.personId,'catalogPurchase_not_found',404);
  insist(Object.keys(input).every(k=>['personId','catalogVersionId','requestId','channel'].includes(k)),'catalog_terms_cannot_be_overridden');
  const member=person(tx.state,isStaff ? input.personId : tx.who.personId),version=currentProductVersion(tx.state,input.catalogVersionId);
  personalCatalogMember(tx.state,member);
  insist(version.kind !== 'intro','catalog_intro_requires_eligibility_review',409);
  insist(!isStaff || ['finite-pack','drop-in'].includes(version.kind),'catalog_membership_requires_billing_sale',409);
  const requestId=text(input.requestId,'requestId',100),sessionFingerprint=await fingerprint(tx);
  const prior=list(tx.state,'catalogPurchase').find(p=>p.createdBy===tx.who.id && p.requestId===requestId);
  if (prior) { insist(prior.personId===member.id && prior.catalogVersion.id===version.id && prior.sessionFingerprint===sessionFingerprint,'catalog_request_changed',409); return exposed(prior); }
  const at=now(),intervalMonths=version.intervalMonths ?? null,termsId=intervalMonths ? id() : null;
  const expiresAt=intervalMonths ? nextInvoiceAt(at,intervalMonths,Number(new Intl.DateTimeFormat('en-US',{day:'numeric',timeZone:version.timeZone}).format(new Date(at))),version.timeZone) : new Date(Date.parse(at)+version.validDays*86_400_000).toISOString();
  const unlimited=['fixed-term','monthly','annual'].includes(version.kind);
  const terms={personId:member.id,catalogVersion:structuredClone(version),credits:version.credits,amountCents:version.amountCents,expiresAt,termStartAt:at,
    eligibleServices:version.eligibleServices,locationId:version.locationId,eligibleLocations:version.eligibleLocations,
    ...(unlimited ? {entitlement:{kind:'unlimited',name:version.name,visits:null,period:null,rollover:0,days:null,from:null,to:null,maxUpcoming:null}} : {})};
  const billing=intervalMonths ? await tx.db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>() : null;
  if (intervalMonths) insist(billing && billing.origin===tx.notices.origin,'catalog_owner_billing_review_required',409);
  const recurring=intervalMonths ? {id:termsId!,connectionId:billing!.connection_id,amountCents:version.amountCents,intervalMonths,noticeLeadDays:30,timeZone:version.timeZone,firstDueAt:expiresAt,stopPath:'/app/packs#recurring-'+termsId,originalInitiationFeeCents:0} : null;
  const creatorSessionCreatedAt=await tx.db.prepare('SELECT created_at FROM oa_sessions WHERE id=? AND operator_id=? AND revoked_at IS NULL').bind(tx.who.sessionId,tx.who.id).first<{created_at:number}>();
  insist(creatorSessionCreatedAt,'native_session_required',403);
  const preview={id:id(),personId:member.id,personVersion:member.version,catalogVersion:structuredClone(version),terms,recurring,
    consent:`${version.name}, catalog version ${version.version}: $${(version.amountCents/100).toFixed(2)} USD added to my studio balance once for ${unlimited ? 'unlimited visits' : version.credits+' class credit(s)'}, from ${at} until ${expiresAt} (exclusive). Eligible services: ${version.eligibleServices.join(', ') || 'All services'}. Eligible locations: ${version.locationNames.map((l: RecordData)=>l.name).join(', ')}. No payment is collected. `+(recurring ? consentText(recurring) : 'No automatic renewal, minimum renewal commitment or cancellation fee is added by this sale.'),
    status:'preview',source:isStaff ? 'staff' : 'member',channel:isStaff ? staffChannel(input) : 'member-self-service',createdBy:tx.who.id,createdByRole:tx.who.role,sessionFingerprint,creatorSessionCreatedAt:creatorSessionCreatedAt.created_at,requestId,createdAt:at,validUntil:new Date(Date.parse(at)+15*60_000).toISOString()};
  const saved={...preview,key:await digest(preview)};
  tx.put('catalogPurchase',saved);return exposed(saved);
}

function live(tx: Transaction, preview: RecordData) {
  const member=person(tx.state,preview.personId);
  insist(member.version===preview.personVersion,'person_changed',409);
  personalCatalogMember(tx.state,member);currentProductVersion(tx.state,preview.catalogVersion.id);
  insist(preview.validUntil>now() && preview.terms.expiresAt>now(),'catalog_preview_expired',409);tx.future(preview.validUntil);tx.future(preview.terms.expiresAt);
}

/** The member personally accepts even when staff prepared the offer. */
export async function confirmCatalogPurchase(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role==='member','member_acceptance_required',403);
  const preview=record(tx.state,input.id,'catalogPurchase');
  insist(preview.personId===tx.who.personId,'catalogPurchase_not_found',404);
  insist(input.key===preview.key && input.confirm===true,'catalog_confirmation_required',409);
  if (preview.status==='sold' || preview.status==='accepted') return exposed(preview);
  live(tx,preview);
  if (preview.source==='member') insist(preview.createdBy===tx.who.id && preview.sessionFingerprint===await fingerprint(tx),'catalog_fresh_preview_required',409);
  // A restored or revoked staff identity cannot solicit new personal acceptance.
  if (preview.source==='staff') {
    const sessions=(await tx.db.prepare('SELECT id FROM oa_sessions WHERE operator_id=? AND created_at=? AND revoked_at IS NULL AND expires_at>?').bind(preview.createdBy,preview.creatorSessionCreatedAt,Date.now()).all<{id:string}>()).results;
    const validSession=(await Promise.all(sessions.map(s=>digest(s.id)))).includes(preview.sessionFingerprint);
    insist(validSession,'catalog_fresh_preview_required',409);
    const actor=await tx.db.prepare("SELECT id,email,role,status,version FROM oa_operators WHERE id=? AND status='active'").bind(preview.createdBy).first();
    insist(actor,'catalog_staff_review_required',409);
    const personId=tx.state.people.find(p=>p.email?.toLowerCase()===String(actor.email).toLowerCase() && p.active && !p.erasedAt)?.id;
    const who={id:preview.createdBy,role:preview.createdByRole,personId,isOwner:actor.role==='owner'} as Actor;
    insist(staffVisible(tx.state,who,preview),'catalog_staff_review_required',409);
  }
  const accepted={...preview,status:'accepted',acceptedAt:now(),acceptedBy:tx.who.id,acceptedChannel:'member-self-service',acknowledgement:{text:preview.consent,key:preview.key,actorId:tx.who.id,personId:preview.personId,at:now()}};
  tx.put('catalogPurchase',accepted);
  return exposed(preview.source==='staff' ? accepted : await complete(tx,accepted));
}

export async function confirmStaffCatalogPurchase(tx: Transaction, input: Record<string,unknown>) {
  authorizeCatalogSale(tx,input);
  const preview=record(tx.state,input.id,'catalogPurchase');
  insist(preview.source==='staff' && preview.sessionFingerprint===await fingerprint(tx),'catalog_fresh_preview_required',409);
  insist(input.key===preview.key && input.confirm===true,'catalog_confirmation_required',409);
  if (preview.status==='sold') return exposed(preview);
  insist(preview.status==='accepted' && preview.acceptedBy,'member_acceptance_required',409);
  live(tx,preview);
  return exposed(await complete(tx,preview));
}

async function complete(tx: Transaction, preview: RecordData) {
  insist(preview.source!=='staff' || ['finite-pack','drop-in'].includes(preview.catalogVersion.kind),'catalog_membership_requires_billing_sale',409);
  const draft={...preview.terms,id:preview.id,catalogPurchaseId:preview.id};
  const sale=grantReviewedPack(tx,draft),pack=record(tx.state,sale.id,'pack');
  if (preview.recurring) {
    const r=preview.recurring,origin=text(tx.notices.origin,'billing_origin',2000);
    const connection=await tx.db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>();
    insist(connection && connection.origin===origin && connection.connection_id===r.connectionId,'catalog_owner_billing_review_required',409);
    const connectionId=connection.connection_id;
    tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_contract_connections WHERE id='billing' AND connection_id=? AND origin=?) THEN 1 ELSE 0 END",connectionId,origin));
    const terms={...r,...packTerms(pack),personId:preview.personId,packId:pack.id,currentPackId:pack.id,status:'active',collection:'studio-balance-only',continuesUntilStopped:true,
      nextRenewalAt:pack.expiresAt,billingDay:Number(new Intl.DateTimeFormat('en-US',{day:'numeric',timeZone:r.timeZone}).format(new Date(pack.expiresAt))),connectionId,billingOrigin:origin,proposalOrigin:origin,
      consent:consentText(r),catalogVersion:preview.catalogVersion,catalogPurchaseId:preview.id,createdBy:preview.createdBy,createdAt:preview.createdAt,acceptedBy:preview.acceptedBy,acceptedAt:preview.acceptedAt,acceptedChannel:'member-self-service',contractAcceptanceChannel:'online',retention:consentRetention(preview.acceptedAt)};
    const key=await digest(terms);
    tx.put('recurringTerms',{...terms,key,acknowledgement:{text:preview.consent,termsKey:key,actorId:preview.acceptedBy,personId:preview.personId,at:preview.acceptedAt,channel:'member-self-service',amountCents:r.amountCents,intervalMonths:r.intervalMonths,firstDueAt:r.firstDueAt,continuesUntilStopped:true,stopPath:r.stopPath}});
  }
  const sold={...preview,status:'sold',packId:pack.id,soldAt:now()};tx.put('catalogPurchase',sold);
  contractNotice(tx,'catalog-purchase:'+preview.id,preview.personId,'Catalog purchase recorded',preview.consent);
  return sold;
}

export function catalogCheckoutSnapshot(state: State, who: Actor) {
  const catalog=productCatalog(state),versions=catalog.products.filter(p=>p.active).map(p=>catalog.versions.find(v=>v.id===p.versionId)!).filter(v=>v.kind!=='intro');
  const allowed=who.role==='owner' || who.role==='member' || hasStaffRight(state,who,'membership-sale');
  return {catalogStore:{versions:allowed ? versions.filter(v=>who.role==='member'||who.role==='owner'&&['finite-pack','drop-in'].includes(v.kind)||['finite-pack','drop-in'].includes(v.kind)&&hasStaffRight(state,who,'membership-sale',undefined,v.locationId)) : []},
    catalogPurchases:list(state,'catalogPurchase').filter(p=>who.role==='owner' || who.role==='member' && p.personId===who.personId || p.createdBy===who.id && staffVisible(state,who,p)).map(exposed)};
}

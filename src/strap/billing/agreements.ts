import { requireStaffRight } from '../domain/staff-rights';
import { membershipDocument } from './document';
import { contractCopy } from '../domain/contract-copies';
import { id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from '../domain/types';
import type { Transaction } from '../domain/store';
import { sha256Hex } from '../security/crypto';
import { canonical, currentAgreement, digest, eligibleAdult, mandateFor, ownMember } from './model';

export const agreementAffirmation = 'I personally sign this exact membership agreement. I confirm I am an adult acting for myself.';
export const mandateAffirmation = 'I separately authorize the exact recurring payments described below, using only a payment method I personally authorize with Stripe. I can revoke this permission immediately from my account.';

export async function prepareAgreement(tx: Transaction,input: Record<string,unknown>) {
  requireStaffRight(tx.state,tx.who,'membership-sale');
  const terms = record(tx.state,input.termsId,'recurringTerms'), member = person(tx.state,terms.personId);
  insist(terms.status === 'active' && terms.acceptedAt,'accepted_recurring_terms_required',409);
  const salePack = record(tx.state,terms.currentPackId,'pack');
  requireStaffRight(tx.state,tx.who,'membership-sale',member.id,salePack.locationId ?? 'studio');
  eligibleAdult(tx.state,member.id);
  insist(input.adultVerified === true,'adult_eligibility_verification_required');
  const requestId = text(input.requestId,'requestId',100), source = {termsId:terms.id,title:text(input.title,'title',160),documentText:text(input.documentText,'documentText',20000),adultEvidenceReference:text(input.adultEvidenceReference,'adultEvidenceReference',200)};
  const prior = list(tx.state,'billingAgreement').find(a=>a.createdBy === tx.who.id && a.requestId === requestId);
  if(prior) { insist(prior.requestBasis === canonical(source),'billing_request_changed',409); return prior; }
  insist(!list(tx.state,'billingAgreement').some(a=>a.termsId === terms.id && !mandateFor(tx.state,a.id)?.revokedAt),'billing_agreement_exists',409);
  const copy = await contractCopy(tx.state,terms), pack = record(tx.state,terms.currentPackId,'pack');
  const agreementId = id(), revocationPath = '/app/packs#billing-'+agreementId;
  const financialTerms = {currency:'usd',amountCents:terms.amountCents,intervalMonths:terms.intervalMonths,firstDueAt:terms.nextRenewalAt,timeZone:terms.timeZone,servicePeriod:{startAt:pack.termStartAt ?? pack.createdAt,endAt:pack.expiresAt},eligibleServices:terms.eligibleServices ?? [],originalAgreementHash:copy.digest,revocationPath,
    meaning:'Permission for the stated future recurring amount only after personal Stripe method authorization. No setup payment is collected. Revocation stops future payment permission immediately; existing studio debt and access follow the original agreement. No miscellaneous staff charge, fee, price increase, ACH debit or guardian authority is granted.'};
  const documentVersion = 1, documentText = membershipDocument(source.title,source.documentText,copy.document,financialTerms);
  const saved = {id:agreementId,personId:member.id,termsId:terms.id,termsKey:terms.key,amountCents:terms.amountCents,intervalMonths:terms.intervalMonths,priceDisclosureId:terms.currentPriceDisclosureId ?? null,requestId,requestBasis:canonical(source),title:source.title,documentText,documentVersion,documentHash:await sha256Hex(documentText),originalAgreement:copy.document,originalAgreementHash:copy.digest,financialTerms,financialHash:await digest(financialTerms),agreementAffirmation,mandateAffirmation,
    adultEvidenceReference:source.adultEvidenceReference,adultVerifiedBy:tx.who.id,createdBy:tx.who.id,createdAt:now(),sellingStaffId:tx.who.id,status:'awaiting-member',signature:null};
  tx.put('billingAgreement',saved);
  tx.put('staffAction',{id:'billing-agreement-launch:'+saved.id,command:'billing.agreement.prepare',action:'billing.agreement.prepare',personId:member.id,actorId:tx.who.id,actorRole:tx.who.role,staffMade:true,right:'membership-sale',channel:'desk',at:saved.createdAt,before:null,after:{id:saved.id,documentHash:saved.documentHash,status:saved.status,sellingStaffId:tx.who.id},requestId});
  return saved;
}
export async function acceptAgreement(tx: Transaction,input: Record<string,unknown>) {
  const agreement = currentAgreement(tx.state,input.id), member = ownMember(tx.state,tx.who,agreement.personId);
  insist(input.documentHash === agreement.documentHash && input.financialHash === agreement.financialHash,'document_changed',409);
  insist(input.confirm === true && input.authorizeRecurring === true && input.adultConfirmed === true,'separate_signature_and_payment_confirmation_required');
  const signerName = text(input.signerName,'signerName',160); insist(signerName === member.name,'signer_name_mismatch');
  if(agreement.signature) { insist(agreement.signature.actorId === tx.who.id && mandateFor(tx.state,agreement.id)?.status === 'accepted','payment_mandate_revoked',409); return agreement; }
  const at = now(), signature = {method:'typed-affirmation',documentHash:agreement.documentHash,documentText:agreement.documentText,documentVersion:agreement.documentVersion,signerPersonId:member.id,signerName,signerEmail:member.email,participantName:member.name,actorId:tx.who.id,confirmed:true,channel:'member-account',deviceContext:{kind:'authenticated-browser'},affirmationText:agreementAffirmation,authority:{kind:'self',adultConfirmed:true,ownerEligibilityEvidenceReference:agreement.adultEvidenceReference},completedAt:at,meaning:'Personal typed affirmation; legal enforceability is not asserted.'};
  const mandate = {id:'payment-mandate:'+agreement.id,agreementId:agreement.id,personId:member.id,termsId:agreement.termsId,status:'accepted',financialTerms:agreement.financialTerms,financialHash:agreement.financialHash,originalAgreementHash:agreement.originalAgreementHash,signedAgreementHash:agreement.documentHash,affirmationText:mandateAffirmation,actorId:tx.who.id,signerPersonId:member.id,signerName,acceptedAt:at,channel:'member-account',methodAuthorized:false,revokedAt:null};
  const signed = {...agreement,status:'signed-awaiting-method',signature,signedAt:at};
  tx.put('billingAgreement',signed); tx.put('paymentMandate',mandate);
  tx.put('billingConsentEvent',{id:'billing-consent:'+agreement.id,personId:member.id,agreementId:agreement.id,mandateId:mandate.id,actorId:tx.who.id,actorRole:tx.who.role,channel:'member-account',at,before:{status:agreement.status},after:{status:signed.status,documentHash:agreement.documentHash,financialHash:agreement.financialHash},staffMade:false});
  return signed;
}
export function revokeMandate(tx: Transaction,input: Record<string,unknown>) {
  const agreement = record(tx.state,input.id,'billingAgreement'); ownMember(tx.state,tx.who,agreement.personId);
  const mandate = mandateFor(tx.state,agreement.id); insist(mandate,'payment_mandate_not_found',404);
  if(mandate.revokedAt)return mandate;
  const at=now(), revoked={...mandate,status:'revoked',revokedAt:at,revokedBy:tx.who.id,revocationChannel:'member-account'};
  tx.put('paymentMandate',revoked); tx.put('billingAgreement',{...agreement,status:'payment-permission-revoked'});
  tx.put('billingConsentEvent',{id:'billing-revoke:'+agreement.id,personId:agreement.personId,agreementId:agreement.id,mandateId:mandate.id,actorId:tx.who.id,actorRole:tx.who.role,channel:'member-account',at,before:{status:mandate.status},after:{status:'revoked'},staffMade:false});
  return revoked;
}
export function agreementEvidence(state: State,who: Actor,id: unknown) {
  const agreement = record(state,id,'billingAgreement');
  insist(!agreement.erased,'billing_agreement_not_found',404);
  insist(who.role === 'owner' && who.isOwner || who.role === 'member' && who.personId === agreement.personId,'billing_agreement_not_found',404);
  return assembleAgreementEvidence(agreement,mandateFor(state,agreement.id));
}

/** Assembly is shared with the already-authorized portable export boundary. */
export function assembleAgreementEvidence(agreement: RecordData,mandate: RecordData|null) {
  const {adultEvidenceReference,requestBasis,...copy}=agreement;
  return {schema:'strap.signed-membership-agreement.v1',agreement:copy,mandate};
}

/** A standalone signed copy, shared by the authenticated download and portable exit. */
export function renderAgreementCopy(evidence: ReturnType<typeof agreementEvidence>) {
  const escape=(value: unknown)=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const agreement=evidence.agreement;
  const block=(title: string,value: unknown)=>`<section><h2>${escape(title)}</h2><pre>${escape(typeof value === 'string'?value:JSON.stringify(value,null,2))}</pre></section>`;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(agreement.title)+' — signed copy</title><style>body{max-width:840px;margin:32px auto;padding:0 20px;color:#20251f;background:#fff;font:16px/1.6 system-ui,sans-serif}h1{line-height:1.2;font-size:28px}h2{font-size:20px;margin-top:28px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}dt{font-weight:700}dd{margin:0 0 12px;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}}</style></head><body><main><h1>'+escape(agreement.title)+'</h1><p>Personal membership agreement and separate recurring-payment permission.</p><dl><dt>Agreement</dt><dd>'+escape(agreement.id)+'</dd><dt>Document version</dt><dd>'+escape(agreement.documentVersion)+'</dd><dt>Document SHA-256</dt><dd>'+escape(agreement.documentHash)+'</dd><dt>Original invoice agreement SHA-256</dt><dd>'+escape(agreement.originalAgreementHash)+'</dd><dt>Completion</dt><dd>'+escape(agreement.signedAt ?? 'Awaiting member signature')+'</dd></dl>'+block('Exact document',agreement.documentText)+block('Personal signature evidence',agreement.signature)+block('Separate recurring-payment terms',agreement.financialTerms)+block('Payment permission and revocation evidence',evidence.mandate)+'<p>This copy records the evidence held by the studio. A signed permission and a saved method do not themselves show a collected payment. Legal enforceability is not asserted.</p></main></body></html>';
}

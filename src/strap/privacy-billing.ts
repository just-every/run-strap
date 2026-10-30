import type { RecordData } from './domain/types';

export const privacyBillingKinds=new Set('billingAgreement paymentMandate billingOperation billingSetup storedPaymentMethod billingConsentEvent billingActionLaunch stripeInvoice billingException billingReconciliation stripeEvent recurringTerms recurringInvoice recurringReminder contractPrepayment'.split(' '));
const authorizationKinds=new Set(['billingSetup','storedPaymentMethod','billingActionLaunch']);
/** Retained financial references are not reusable payment permission or hosted setup credentials. */
export function retireBilling(kind:string,original:RecordData,redacted:RecordData,at:string,actorId:string) {
  const saved={...redacted,erased:true,privacyRetiredAt:at};
  if(authorizationKinds.has(kind))return Object.fromEntries(Object.entries({...saved,status:'retired',revokedAt:at,revokedBy:actorId}).filter(([key])=>[
    'id','personId','agreementId','mandateId','setupId','operationId','createdAt','authorizedAt','status','revokedAt','revokedBy','erased','privacyRetiredAt','privacyReceiptId',
  ].includes(key))) as RecordData;
  if(kind==='paymentMandate')Object.assign(saved,{status:'revoked',revokedAt:original.revokedAt??at,revokedBy:actorId,revocationChannel:'verified-privacy-request',methodAuthorized:false,methodId:null,signerName:null});
  if(kind==='billingAgreement')Object.assign(saved,{status:'privacy-retired',signature:null,documentText:null,originalAgreement:null,adultEvidenceReference:null,requestBasis:null});
  if(kind==='billingOperation')Object.assign(saved,{status:'retired',inputHash:null,launchURL:null});
  if(kind==='billingActionLaunch')Object.assign(saved,{status:'retired',requestBasis:null});
  if(kind==='recurringTerms')Object.assign(saved,{status:'stopped',stoppedAt:original.stoppedAt??at,stoppedBy:actorId,stopChannel:'verified-privacy-request',stopReason:'Member erasure',key:null,basis:null});
  if(kind==='recurringReminder')Object.assign(saved,{body:null});
  return saved;
}

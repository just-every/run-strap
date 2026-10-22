import { coolingRefund } from './cooling-refunds';
import { coolingAgreementPackIds } from './cooling-void';
import { studioSettings } from './studio';
import { coolingOffWindow, refundSettlementWindow } from './cancellation-calendar';
import { contractCopy, contractDeliveredAt, contractRegion } from './contract-copies';
import { humanOwner, id, insist, instant, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent, bookingCredit } from './pack-credits';
import { bookingHistory } from './booking-history';
import { contractNotice } from './contract-billing';
import { balance } from './money';
import { staffChannel } from './staff-actions';
import { activeContractAuthorities, authorizeContractCancellation, canCancelContract, contractAuthoritySnapshot, contractRecipients } from './contract-authority';
import { retainRefundDue, unusedPrepaid } from './cancellation-value';
import { cancellationFreezeEffects, cancellationTermEnd, endCancellationFreezes, supersedeScheduledFreezes } from './cancellation-freezes';

/** PLAN-007 / PLAN-012 native-invoice scope; ct ruling 22 Oct. No custody. */
export interface CancellationEffects extends RecordData { effectiveAt:string; existingBalanceCents:number; projectedFinalBalanceCents:number; guestPriceReversals:RecordData[]; bookings:RecordData[]; freezes:RecordData[] }
export interface CancellationPreview extends RecordData { personId:string; packId:string; termsId:string; status:string; effectiveAt:string; effects:CancellationEffects; basis:string; key:string }
const live=(c:RecordData)=>c.status==='scheduled';
const fingerprint=(input:Record<string,unknown>)=>JSON.stringify(Object.keys(input).sort().map(k=>[k,input[k]]));
export const cancellationForTerms=(state:State,termsId:string)=>list(state,'contractCancellation').find(c=>c.termsId===termsId&&['scheduled','applied'].includes(c.status))??null;
export const cancellationBlocks=(state:State,packId:string,classStart:string)=>list(state,'contractCancellation').some(c=>c.packId===packId&&['scheduled','applied'].includes(c.status)&&classStart>=c.effectiveAt);
const policy=(state:State)=>state.records.get('cancellation-policy')?.data??{id:'cancellation-policy',coolingOffDays:5,relocationMiles:25};
export function saveCancellationPolicy(tx:Transaction,input:Record<string,unknown>){
  humanOwner(tx.who);const old=policy(tx.state),deductions=input.coolingDeductions??old.coolingDeductions??{};
  insist(deductions&&typeof deductions==='object'&&!Array.isArray(deductions),'invalid_cooling_deductions');
  insist(Object.entries(deductions).every(([region,on])=>['GA','FL','CA'].includes(region)&&typeof on==='boolean'),'invalid_cooling_deductions');
  const studioOpenedOn=input.studioOpenedOn===undefined?old.studioOpenedOn:input.studioOpenedOn;
  insist(!studioOpenedOn||typeof studioOpenedOn==='string'&&/^\d{4}-\d\d-\d\d$/.test(studioOpenedOn)&&Number.isFinite(Date.parse(studioOpenedOn+'T00:00:00Z'))&&new Date(studioOpenedOn+'T00:00:00Z').toISOString().slice(0,10)===studioOpenedOn,'invalid_studio_opened_on');
  const studioOpeningEvidenceReference=studioOpenedOn?text(input.studioOpeningEvidenceReference??old.studioOpeningEvidenceReference,'studioOpeningEvidenceReference',200):null;
  const p={id:'cancellation-policy',coolingOffDays:integer(input.coolingOffDays,'coolingOffDays',5,365),relocationMiles:integer(input.relocationMiles??25,'relocationMiles',1,1000),studioOpenedOn:studioOpenedOn||null,studioOpeningEvidenceReference,coolingDeductions:deductions,updatedAt:now(),updatedBy:tx.who.id};tx.put('cancellationPolicy',p);return p;
}
function replay(tx:Transaction,kind:string,input:Record<string,unknown>){const requestId=text(input.requestId,'requestId',100),requestBasis=fingerprint(input),prior=list(tx.state,kind).find(c=>c.createdBy===tx.who.id&&c.requestId===requestId);if(prior)insist(prior.requestBasis===requestBasis,'cancellation_request_changed',409);return {prior,requestId,requestBasis};}
function contract(state:State,packId:unknown){
  const pack=record(state,packId,'pack');person(state,pack.personId);
  const candidates=list(state,'recurringTerms').filter(t=>t.currentPackId===pack.id&&t.acceptedAt&&t.acceptedBy);
  const terms=candidates.find(t=>['active','needs_review','needs_reconnection'].includes(t.status))??candidates.sort((a,b)=>b.acceptedAt.localeCompare(a.acceptedAt)).at(0);
  insist(terms,'accepted_recurring_terms_required',409);return {pack,terms};
}
/** Initial receipt and each shipped statutory renewal grant keep separate clocks. */
function coolingWindows(state:State,pack:RecordData,terms:RecordData){
  const facts={acceptedAt:terms.acceptedAt,deliveredAt:contractDeliveredAt(state,terms.id),memberRegion:contractRegion(state,pack.personId),amountCents:terms.amountCents+(terms.originalInitiationFeeCents??0),days:policy(state).coolingOffDays,acceptanceChannel:terms.contractAcceptanceChannel,studioOpenedOn:terms.studioOpenedOn};
  const initial=coolingOffWindow(state,facts);
  const renewals=list(state,'recurringInvoice').filter(i=>i.recurringTermsId===terms.id&&i.packId===pack.id).map(i=>coolingOffWindow(state,{...facts,renewal:{at:i.dueAt,intervalMonths:terms.intervalMonths,invoiceId:i.id}})).filter(w=>w.rules.length);
  return [initial,...renewals];
}
function currentCooling(state:State,pack:RecordData,terms:RecordData){return coolingWindows(state,pack,terms).sort((a,b)=>a.deadline===null?-1:b.deadline===null?1:b.deadline.localeCompare(a.deadline))[0];}
const affected=(state:State,packId:string,at:string)=>list(state,'booking').filter(b=>(b.packId===packId||b.guestPackId===packId)&&['booked','waitlisted','offered'].includes(b.status)&&(state.records.get(b.classId)?.data.start??'')>=at).sort((a,b)=>a.id.localeCompare(b.id));
function guestReversals(state:State,packId:string,at:string){const ids=new Set(affected(state,packId,at).filter(b=>b.status==='booked'&&b.guestPackId).map(b=>b.id)),charges=list(state,'charge');return charges.filter(c=>ids.has(c.bookingId)&&c.reason==='guest_drop_in'&&!charges.some(r=>r.reversesChargeId===c.id)).map(c=>({id:c.id,chargeId:c.id,bookingId:c.bookingId,personId:c.personId,amountCents:-c.amountCents}));}
async function source(state:State,pack:RecordData,terms:RecordData,at:string){const json=JSON.stringify({pack,terms,member:person(state,pack.personId,false),policy:policy(state),serviceValues:list(state,'coolingServiceValue').filter(v=>v.personId===pack.personId),coolingOff:currentCooling(state,pack,terms),bookings:affected(state,pack.id,at).map(booking=>({booking,class:state.records.get(booking.classId)?.data})),
  changes:list(state,'planChange').filter(c=>c.packId===pack.id&&c.status==='accepted'),freezes:list(state,'freeze').filter(f=>f.packId===pack.id),charges:list(state,'charge').filter(r=>r.personId===pack.personId||affected(state,pack.id,at).some(b=>b.guestPackId&&r.bookingId===b.id)).map(r=>({id:r.id,amountCents:r.amountCents,personId:r.personId,packId:r.packId,bookingId:r.bookingId,reason:r.reason,reversesChargeId:r.reversesChargeId})),payments:list(state,'payment').filter(r=>r.personId===pack.personId||list(state,'contractPrepayment').some(a=>a.packId===pack.id&&a.paymentId===r.id)).map(r=>({id:r.id,personId:r.personId,amountCents:r.amountCents})),allocations:list(state,'contractPrepayment').filter(a=>a.packId===pack.id).map(a=>({id:a.id,paymentId:a.paymentId,chargeId:a.chargeId,payerId:a.payerId,amountCents:a.amountCents})),authorities:activeContractAuthorities(state,pack.personId).map(g=>({id:g.id,kind:g.kind,delegateId:g.delegateId,adultAt:g.adultAt,memberAcceptedAt:g.memberAcceptedAt,delegateAcceptedAt:g.delegateAcceptedAt})),cancellations:list(state,'contractCancellation').filter(c=>c.termsId===terms.id&&live(c))});const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json));return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}
function effects(state:State,pack:RecordData,terms:RecordData,at:string):CancellationEffects{
  const reversals=guestReversals(state,pack.id,at),freezes=cancellationFreezeEffects(state,pack.id),feeReturns=freezes.reduce((n,f)=>n+(f.chargeId&&state.records.get(f.chargeId)?.data.personId===pack.personId?f.feeReversedCents:0),0);
  return {id:`effects:${pack.id}`,effectiveAt:at,remainingCredits:pack.remaining,finalChargeCents:0,existingBalanceCents:balance(state,pack.personId),projectedFinalBalanceCents:balance(state,pack.personId)+reversals.filter(r=>r.personId===pack.personId).reduce((n,r)=>n+r.amountCents,0)-feeReturns,
    guestPriceReversals:reversals,freezes,unusedPrepaid:unusedPrepaid(state,pack,at),refundPolicy:'Unused allocated prepaid value is refund due, settled externally. Unallocated receipts remain visibly awaiting reconciliation. No provider refund or account credit is issued.',remainingValue:'Remaining credits expire as retained history; no forfeiture or invented commitment fee.',collection:'studio-balance-only',stoppedRenewalAt:terms.nextRenewalAt,
    bookings:affected(state,pack.id,at).map(b=>({id:b.id,bookingId:b.id,personId:b.personId,classId:b.classId,start:state.records.get(b.classId)?.data.start,packId:b.packId??null,guestPackId:b.guestPackId??null,status:b.status,effect:'cancel at effective instant; original funding returned once; no cancellation fee'}))};
}
function notify(tx:Transaction,c:RecordData,sourceId:string,subject:string,body:string){for(const recipient of new Set([...contractRecipients(tx.state,c.personId,c.termsId),...list(tx.state,'contractPrepayment').filter(a=>a.packId===c.packId).map(a=>a.payerId)]))contractNotice(tx,`${sourceId}:${recipient}`,recipient,subject,body);}
function notice(c:RecordData){const value=c.effects.unusedPrepaid;return `Effective ${c.effectiveAt}. Existing balance ${c.effects.existingBalanceCents} cents; projected balance after listed original-price and freeze-fee reversals ${c.effects.projectedFinalBalanceCents} cents. Additional bill 0 cents. ${c.disposition==='refund_due'?value.amountCents===null?'Refund due awaits receipt allocation; no paid value was assumed.':`Unused prepaid refund due ${value.amountCents} cents, settled externally.`:'Access continues to the paid term end; no renewal invoice follows.'} ${c.coolingOff?'Cooling-off closes '+(c.coolingOff.deadline??'only after recorded contract delivery')+' under '+(c.coolingOff.governingRule?.label??'delivery pending')+'. ':''}${c.refundDeadline?'Refund settle-by '+c.refundDeadline.settleBy+'. ':''}${c.effects.remainingCredits} credits at preview; unused credits expire when access ends and remain in history. ${c.effects.bookings.length} affected seats cancel without fee. Other packs and separate makeup grants stay unchanged. No payment collected or provider refund sent.`;}
async function prepare(tx:Transaction,input:Record<string,unknown>,mode:string,at:string,reason:string,exceptionReason:string|null){
  const r=replay(tx,'contractCancellation',input);if(r.prior)return r.prior;
  const {pack,terms}=contract(tx.state,input.packId);insist(!cancellationForTerms(tx.state,terms.id),'cancellation_pending',409);
  const preview={id:id(),personId:pack.personId,packId:pack.id,termsId:terms.id,mode,effectiveAt:at,reason,exceptionReason,status:'preview',disposition:mode==='term_end'?'term_end':'refund_due',effects:effects(tx.state,pack,terms,at),basis:await source(tx.state,pack,terms,at),createdAt:now(),createdBy:tx.who.id,requestId:r.requestId,requestBasis:r.requestBasis};
  const saved={...preview,key:id()};tx.put('contractCancellation',saved);return saved;
}
function schedule(tx:Transaction,c:RecordData,input:Record<string,unknown>){
  const terms=record(tx.state,c.termsId,'recurringTerms'),at=now(),channel=tx.who.role==='owner'?staffChannel(input):'member-self-service';
  const scheduled={...c,status:'scheduled',terminatedBy:tx.who.id,terminatedRole:tx.who.role,confirmedBy:tx.who.id,confirmedAt:at,confirmationRequestId:text(input.requestId,'requestId',100),confirmationBasis:fingerprint(input),channel,staffActionId:id()};
  supersedeScheduledFreezes(tx,scheduled);tx.put('contractCancellation',scheduled);
  tx.put('recurringTerms',{...terms,status:'cancellation_scheduled',cancellationId:c.id,cancellationEffectiveAt:c.effectiveAt,stoppedAt:terms.stoppedAt??at,stoppedBy:terms.stoppedBy??tx.who.id,stopReason:terms.stopReason??null,stopChannel:terms.stopChannel??channel,stop:terms.stop??{actorId:tx.who.id,personId:c.personId,at,channel,reason:null,effectiveAt:at,accessEndsAt:c.effectiveAt}});
  for(const change of list(tx.state,'planChange').filter(p=>p.packId===c.packId&&p.status==='accepted'))tx.put('planChange',{...change,status:'cancelled',cancellationId:c.id,finishedAt:at});
  notify(tx,scheduled,`cancellation-confirm:${c.id}`,'Cancellation confirmed',notice(scheduled));return scheduled;
}
/** One step, no reason/approval. A requestId identifies retries, never a gate. */
export async function stopCancellation(tx:Transaction,input:Record<string,unknown>){
  const {pack,terms}=contract(tx.state,input.packId);authorizeContractCancellation(tx,pack.personId,terms.id);
  const prior=cancellationForTerms(tx.state,terms.id);if(prior)return prior;
  const at=cancellationTermEnd(tx.state,pack),c=await prepare(tx,input,'term_end',at,'Renewal stopped',null),scheduled=schedule(tx,c,input);
  if(at<=now())applyDueCancellations(tx);return tx.state.records.get(scheduled.id)!.data;
}
/** Metadata reference only; this door does not ingest medical documents. */
export async function statutoryCancellation(tx:Transaction,input:Record<string,unknown>){
  const {pack,terms}=contract(tx.state,input.packId);authorizeContractCancellation(tx,pack.personId,terms.id);
  const r=replay(tx,'contractCancellation',input);if(r.prior)return r.prior;
  const reasonCode=text(input.reasonCode,'reasonCode',30),documentedAt=instant(input.documentedAt,'documentedAt'),evidenceReference=text(input.evidenceReference,'evidenceReference',200),p=policy(tx.state);
  insist(['death','disability','relocation','cooling-off'].includes(reasonCode),'invalid_statutory_reason');insist(documentedAt<=now(),'documented_request_must_be_past');
  if(reasonCode==='relocation')insist(typeof input.relocationMiles==='number'&&Number.isFinite(input.relocationMiles)&&input.relocationMiles>p.relocationMiles,'statutory_relocation_not_eligible',409);
  const coolingOff=reasonCode==='cooling-off'?coolingWindows(tx.state,pack,terms).filter(w=>documentedAt>=terms.acceptedAt&&(!w.renewal||documentedAt>=w.opensAt)&&(!w.deadline||documentedAt<w.deadline)).sort((a,b)=>Number(!!b.renewal)-Number(!!a.renewal))[0]:null;
  if(reasonCode==='cooling-off')insist(coolingOff,'cooling_off_window_ended',409);
  const prior=cancellationForTerms(tx.state,terms.id);insist(prior?.status!=='applied','contract_already_ended',409);
  const value=reasonCode==='cooling-off'?coolingRefund(tx.state,pack,documentedAt,{packIds:coolingAgreementPackIds(tx.state,{id:terms.id,packId:pack.id,termsId:terms.id,coolingOff}),regions:[studioSettings(tx.state)?.address?.region,contractRegion(tx.state,pack.personId)].filter(Boolean),policy:p}):unusedPrepaid(tx.state,pack,documentedAt);
  const basis=await source(tx.state,pack,terms,documentedAt);
  if(input.previewOnly===true||input.previewOnly==='yes'){
    const preview={id:id(),personId:pack.personId,packId:pack.id,termsId:terms.id,reasonCode,documentedAt,evidenceReference,relocationMiles:input.relocationMiles??null,value,coolingOff,basis,createdBy:tx.who.id,createdAt:now()};tx.put('statutoryRefundPreview',preview);return preview;
  }
  if(input.previewId){const preview=record(tx.state,input.previewId,'statutoryRefundPreview');insist(preview.createdBy===tx.who.id&&preview.packId===pack.id&&preview.reasonCode===reasonCode&&preview.documentedAt===documentedAt&&preview.basis===basis,'statutory_preview_changed',409);}
  // Supersede any later cancellation without permitting a second refund identity.
  if(prior){tx.put('contractCancellation',{...prior,status:'superseded',supersededAt:now()});}
  const c=await prepare(tx,input,'statutory',documentedAt,reasonCode,null),documented={...c,reasonCode,documentedAt,evidenceReference,policy:{...p},coolingOff,effects:{...c.effects,unusedPrepaid:value},refundDeadline:refundSettlementWindow(tx.state,now(),[contractRegion(tx.state,pack.personId)].filter(Boolean))};
  tx.put('contractCancellation',documented);const scheduled=schedule(tx,documented,input);applyDueCancellations(tx);if(input.previewId){const preview=record(tx.state,input.previewId,'statutoryRefundPreview');tx.put('statutoryRefundPreview',{...preview,submittedAt:now(),cancellationId:scheduled.id});}return tx.state.records.get(scheduled.id)!.data;
}
export async function requestCancellation(tx:Transaction,input:Record<string,unknown>){
  const {pack,terms}=contract(tx.state,input.packId);authorizeContractCancellation(tx,pack.personId,terms.id);insist(tx.who.role==='member','member_required',403);
  if(!input.effectiveAt||instant(input.effectiveAt,'effectiveAt')>=cancellationTermEnd(tx.state,pack))return stopCancellation(tx,input);
  const r=replay(tx,'cancellationRequest',input);if(r.prior)return r.prior;
  const effectiveAt=instant(input.effectiveAt,'effectiveAt');insist(effectiveAt>now(),'invalid_cancellation_date',409);
  const request={id:id(),personId:pack.personId,packId:pack.id,termsId:terms.id,effectiveAt,reason:text(input.reason,'reason',500),status:'requested',createdAt:now(),createdBy:tx.who.id,requestId:r.requestId,requestBasis:r.requestBasis};tx.put('cancellationRequest',request);return request;
}
export async function prepareCancellation(tx:Transaction,input:Record<string,unknown>){
  humanOwner(tx.who);const request=input.cancellationRequestId?record(tx.state,input.cancellationRequestId,'cancellationRequest'):null;
  insist(!request||request.status==='requested','cancellation_request_closed',409);const merged={...request,...input}, {pack}=contract(tx.state,merged.packId),at=merged.effectiveAt?instant(merged.effectiveAt,'effectiveAt'):cancellationTermEnd(tx.state,pack);
  insist(at>now()&&at<=cancellationTermEnd(tx.state,pack),'invalid_cancellation_date',409);insist(!input.disposition||input.disposition==='refund_due','accepted_sale_terms_required',409);
  const reason=text(merged.reason,'reason',500),c=await prepare(tx,{...input,packId:pack.id},'early',at,reason,input.exceptionReason?text(input.exceptionReason,'exceptionReason',500):reason);
  if(request){const linked={...c,cancellationRequestId:request.id};tx.put('contractCancellation',linked);return linked;}return c;
}
export async function confirmCancellation(tx:Transaction,input:Record<string,unknown>){
  humanOwner(tx.who);const c=record(tx.state,input.id,'contractCancellation');insist(input.key===c.key,'preview_changed',409);
  if(c.confirmedAt){insist(c.terminatedBy===tx.who.id&&c.confirmationBasis===fingerprint(input),'cancellation_confirmation_closed',409);return c;}
  insist(c.status==='preview'&&c.effectiveAt>now(),'cancellation_preview_expired',409);const {pack,terms}=contract(tx.state,c.packId);insist(c.basis===await source(tx.state,pack,terms,c.effectiveAt),'cancellation_source_changed',409);tx.future(c.effectiveAt);
  const scheduled=schedule(tx,c,input);if(c.cancellationRequestId){const r=record(tx.state,c.cancellationRequestId,'cancellationRequest');tx.put('cancellationRequest',{...r,status:'approved',cancellationId:c.id});}return scheduled;
}
async function withdrawalBasis(state:State,c:RecordData){const json=JSON.stringify({c,pack:record(state,c.packId,'pack'),terms:record(state,c.termsId,'recurringTerms')});const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json));return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}
export async function prepareWithdrawCancellation(tx:Transaction,input:Record<string,unknown>){
  const c=record(tx.state,input.id,'contractCancellation');insist(c.terminatedBy===tx.who.id,'terminator_required',403);authorizeContractCancellation(tx,c.personId,c.termsId);
  const r=replay(tx,'cancellationWithdrawal',input);if(r.prior)return r.prior;insist(live(c)&&c.effectiveAt>now(),'cancellation_not_withdrawable',409);
  const preview={id:id(),personId:c.personId,packId:c.packId,cancellationId:c.id,status:'preview',basis:await withdrawalBasis(tx.state,c),reason:input.reason?text(input.reason,'reason',500):null,requiresFreshAcceptance:true,createdAt:now(),createdBy:tx.who.id,requestId:r.requestId,requestBasis:r.requestBasis};const saved={...preview,key:id()};tx.put('cancellationWithdrawal',saved);return saved;
}
export async function confirmWithdrawCancellation(tx:Transaction,input:Record<string,unknown>){
  const w=record(tx.state,input.id,'cancellationWithdrawal'),c=record(tx.state,w.cancellationId,'contractCancellation');insist(c.terminatedBy===tx.who.id,'terminator_required',403);authorizeContractCancellation(tx,c.personId,c.termsId);insist(input.key===w.key,'preview_changed',409);
  if(w.confirmedAt){insist(w.confirmationBasis===fingerprint(input),'cancellation_confirmation_closed',409);return w;}
  insist(live(c)&&c.effectiveAt>now()&&w.basis===await withdrawalBasis(tx.state,c),'cancellation_not_withdrawable',409);tx.future(c.effectiveAt);
  const terms=record(tx.state,c.termsId,'recurringTerms');tx.put('recurringTerms',{...terms,status:'stopped',requiresFreshAcceptance:true});tx.put('contractCancellation',{...c,status:'withdrawn',withdrawnAt:now(),withdrawnBy:tx.who.id,withdrawalId:w.id});
  const confirmed={...w,status:'confirmed',confirmedAt:now(),confirmedBy:tx.who.id,confirmationBasis:fingerprint(input),billingStatus:'stopped'};tx.put('cancellationWithdrawal',confirmed);notify(tx,c,`cancellation-withdraw:${w.id}`,'Cancellation withdrawn','The terminator withdrew the scheduled end of access. Invoices stay stopped. Resuming requires a fresh owner proposal and the member’s own acceptance of the exact invoice preview. No old charge is replayed; withdrawn freezes and cancelled seats stay withdrawn/cancelled.');return confirmed;
}
export function launchCancellationWithdrawal(tx:Transaction,input:Record<string,unknown>){humanOwner(tx.who);text(input.requestId,'requestId',100);const target=tx.state.records.get(String(input.id));insist(target&&['contractCancellation','cancellationWithdrawal'].includes(target.kind),'contractCancellation_not_found',404);const c=target.kind==='cancellationWithdrawal'?record(tx.state,target.data.cancellationId,'contractCancellation'):target.data;return {id:id(),personId:c.personId,previewId:c.id,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fpacks%23cancellations'};}
/** Before invoices and check-in; promote freed seats after the transaction. */
export function applyDueCancellations(tx:Transaction){
  for(const c of list(tx.state,'contractCancellation').filter(c=>live(c)&&c.effectiveAt<=now())){
    tx.reached(c.effectiveAt);const pack=record(tx.state,c.packId,'pack'),terms=record(tx.state,c.termsId,'recurringTerms'),reversals=guestReversals(tx.state,pack.id,c.effectiveAt);
    const refund=c.disposition==='refund_due'?retainRefundDue(tx,c):null;
    for(const b of affected(tx.state,pack.id,c.effectiveAt)){
      const returned=b.status==='booked';if(returned)bookingCredit(tx,b,{type:'restore',credits:1,bookingId:b.id,classId:b.classId,reason:`Cancellation ${c.id}`});
      const after={...b,status:'cancelled',cancellation:'contract-termination',cancellationId:`termination:${c.id}:${b.id}`,cancelledAt:c.effectiveAt,cancelledBy:c.terminatedBy,cancelledByRole:c.terminatedRole,refunded:returned,feeCents:0,contractCancellationId:c.id};tx.put('booking',after);
      if(b.guestPackId)contractNotice(tx,`cancellation-guest:${c.id}:${b.id}`,b.personId,'Guest booking cancelled','The host’s membership ended. This guest seat was cancelled without a fee; its original pass was returned or its original studio-balance price reversed once to the original payer. No payment or provider refund was sent.',[b.id]);
      bookingHistory(tx,'cancel',b,after,{reason:c.reason,channel:c.channel==='member-self-service'?'desk':c.channel},{id:after.cancellationId,parentActionId:c.staffActionId,actorId:c.terminatedBy,actorRole:c.terminatedRole,staffMade:c.terminatedRole==='owner',right:c.terminatedRole==='owner'?'contract-change':null,channel:c.channel,reason:c.reason,comment:c.reason});
    }
    endCancellationFreezes(tx,c);appendPackEvent(tx,record(tx.state,pack.id,'pack'),{type:'adjust',credits:0,expiresAt:c.effectiveAt,reason:`Contract ended ${c.id}`});tx.put('recurringTerms',{...terms,status:'stopped',accessEndedAt:c.effectiveAt});
    const statementId=`final-statement:${c.id}`;tx.put('cancellationStatement',{id:statementId,personId:c.personId,packId:pack.id,cancellationId:c.id,effectiveAt:c.effectiveAt,additionalChargeCents:0,balanceCents:balance(tx.state,c.personId),guestPriceReversals:reversals,refundId:refund?.id??null,refundDueCents:refund?.amountCents??null,collection:'external-settlement-only',createdAt:now()});
    for(const payerId of new Set(reversals.map(r=>r.personId)))if(payerId!==c.personId)contractNotice(tx,`cancellation-guest-reversal:${c.id}:${payerId}`,payerId,'Guest price reversed',`Original guest price reversed against your studio balance once. No account credit or provider refund was issued.`);
    tx.put('contractCancellation',{...c,status:'applied',appliedAt:c.effectiveAt,processedAt:now(),statementId,refundId:refund?.id??null});notify(tx,c,`cancellation-effective:${c.id}`,'Membership ended',`${notice(c)} Final studio balance ${balance(tx.state,c.personId)} cents. Refund record ${refund?.id??'none'}.`);
  }
}
export async function cancellationsSnapshot(state:State,who:Actor){
  const termsOf=(r:RecordData)=>r.termsId??(r.cancellationId?state.records.get(r.cancellationId)?.data.termsId:r.refundId?state.records.get(state.records.get(r.refundId)?.data.cancellationId)?.data.termsId:undefined);
  const visible=(r:RecordData)=>canCancelContract(state,who,r.personId,termsOf(r));
  const cancellations=await Promise.all(list(state,'contractCancellation').filter(visible).map(async c=>({...c,canWithdraw:c.terminatedBy===who.id&&live(c)&&c.effectiveAt>now(),stale:c.status==='preview'&&(c.effectiveAt<=now()||c.basis!==await source(state,record(state,c.packId,'pack'),record(state,c.termsId,'recurringTerms'),c.effectiveAt))})));
  return {policy:policy(state),statutoryPreviews:list(state,'statutoryRefundPreview').filter(p=>!p.submittedAt&&p.createdBy===who.id&&visible(p)),authorities:contractAuthoritySnapshot(state,who),contracts:await Promise.all(list(state,'recurringTerms').filter(t=>canCancelContract(state,who,t.personId,t.id)).filter(t=>t.currentPackId&&contract(state,t.currentPackId).terms.id===t.id).map(async t=>{const pack=record(state,t.currentPackId,'pack');return {id:t.id,personId:t.personId,participantName:person(state,t.personId,false).name,packId:t.currentPackId,status:t.status,acceptedAt:t.acceptedAt,nextRenewalAt:t.nextRenewalAt,pack,memberRegion:contractRegion(state,t.personId),copy:await contractCopy(state,t),deliveredAt:contractDeliveredAt(state,t.id),coolingOff:currentCooling(state,pack,t)};})),requests:list(state,'cancellationRequest').filter(visible),cancellations,
    withdrawals:await Promise.all(list(state,'cancellationWithdrawal').filter(visible).map(async w=>({...w,canConfirm:who.id===w.createdBy,stale:w.status==='preview'&&(!live(record(state,w.cancellationId,'contractCancellation'))||w.basis!==await withdrawalBasis(state,record(state,w.cancellationId,'contractCancellation')))}))),statements:list(state,'cancellationStatement').filter(visible),refunds:list(state,'cancellationRefund').filter(visible),settlements:list(state,'cancellationRefundSettlement').filter(visible)};
}

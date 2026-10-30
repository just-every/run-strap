import { sha256 } from '../../modules/import-kit/src/d1/index';
import { id, insist, list, now, person, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { freezeBasis, freezeEndBasis, requireFreezeStaff, authorizeFreezeCommand, freezeKeyMatches } from './freezes';
import { calendarDays, shiftCalendarDays } from './freeze-calendar';
import { appendPackEvent, bookingCredit, studioZone } from './pack-credits';
import { bookingHistory } from './booking-history';
import { contractNotice, moveRecurringRenewal } from './contract-billing';

function own(tx: Transaction, personId: string) {
  person(tx.state,personId); insist(tx.who.role === 'owner' && tx.who.isOwner || tx.who.role === 'member' && tx.who.personId === personId,'freeze_not_found',404);
}
function acceptance(tx: Transaction, input: Record<string,unknown>, ending: boolean) {
  insist(tx.who.role === 'member','member_acceptance_required',403);
  const preview=record(tx.state,input.id,ending ? 'freezeEnd' : 'freeze'), freeze=ending ? record(tx.state,preview.freezeId,'freeze') : preview;
  own(tx,preview.personId); insist(freezeKeyMatches(input.key,preview.key),'preview_changed',409);
  insist(preview.status==='preview' && (ending ? preview.endAt : freeze.startAt)>now(),'freeze_preview_expired',409);
  const basis=ending ? freezeEndBasis(tx.state,freeze) : freezeBasis(tx.state,record(tx.state,freeze.packId,'pack'),freeze);
  insist(preview.basis===basis,'freeze_source_changed',409);
  tx.future(ending ? preview.endAt : freeze.startAt);
  if(preview.acceptedAt) return preview;
  const accepted={...preview,acceptedAt:now(),acceptedBy:tx.who.id,acceptanceBasis:basis,acceptanceKey:preview.key};
  tx.put(ending ? 'freezeEnd' : 'freeze',accepted);return accepted;
}
export const acceptFreeze=(tx:Transaction,input:Record<string,unknown>)=>acceptance(tx,input,false);
export const acceptFreezeEnd=(tx:Transaction,input:Record<string,unknown>)=>acceptance(tx,input,true);
function launch(tx:Transaction,input:Record<string,unknown>,ending:boolean) {
  authorizeFreezeCommand(tx,ending?'freeze.end.accept.launch':'freeze.accept.launch',input);text(input.requestId,'requestId',100);
  checkFreezeLaunch(tx,input,ending);
  const preview=record(tx.state,input.id,ending ? 'freezeEnd' : 'freeze');person(tx.state,preview.personId);
  return {id:id(),personId:preview.personId,previewId:preview.id,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fpacks%23freezes'};
}
export function checkFreezeLaunch(tx:Transaction,input:Record<string,unknown>,ending:boolean) {
  const preview=record(tx.state,input.id,ending?'freezeEnd':'freeze'),freeze=ending?record(tx.state,preview.freezeId,'freeze'):preview;
  insist(preview.status==='preview' && (ending?preview.endAt:preview.startAt)>now(),'freeze_preview_expired',409);
  const basis=ending?freezeEndBasis(tx.state,freeze):freezeBasis(tx.state,record(tx.state,preview.packId,'pack'),freeze);
  insist(preview.basis===basis,'freeze_source_changed',409);
}
export const launchFreezeAcceptance=(tx:Transaction,input:Record<string,unknown>)=>launch(tx,input,false);
export const launchFreezeEndAcceptance=(tx:Transaction,input:Record<string,unknown>)=>launch(tx,input,true);
function closeRequest(tx:Transaction,input:Record<string,unknown>,decline:boolean) {
  const request=record(tx.state,input.id,'freezeRequest');if(!['owner','front-desk','manager'].includes(tx.who.role)&&!decline)own(tx,request.personId);else requireFreezeStaff(tx.state,tx.who,request.packId);
  const requestId=text(input.requestId,'requestId',100), reason=decline || tx.who.role!=='member' ? text(input.reason,'reason',500) : input.reason ? text(input.reason,'reason',500) : null;
  const status=decline ? 'declined' : 'withdrawn';
  if(request.status===status){insist(request.closedBy===tx.who.id&&request.closeRequestId===requestId&&request.closeReason===reason,'freeze_request_changed',409);return request;}
  insist(request.status==='requested','freeze_request_closed',409);
  const closed={...request,status,closedAt:now(),closedBy:tx.who.id,closeRequestId:requestId,closeReason:reason,...(decline?{declineReason:reason}:{withdrawalReason:reason})};tx.put('freezeRequest',closed);
  for(const preview of list(tx.state,'freeze').filter(f=>f.freezeRequestId===request.id&&f.status==='preview'))tx.put('freeze',{...preview,status});
  contractNotice(tx,`freeze-request-${status}:${request.id}`,request.personId,decline?'Freeze request declined':'Freeze request withdrawn',`${decline?'The studio declined':'You withdrew'} the freeze request. ${reason ?? ''} No fee, booking or term date changed.`);return closed;
}
export const declineFreezeRequest=(tx:Transaction,input:Record<string,unknown>)=>closeRequest(tx,input,true);
export const withdrawFreezeRequest=(tx:Transaction,input:Record<string,unknown>)=>closeRequest(tx,input,false);
export function freezeWithdrawal(state:State,freeze:RecordData) {
  if(freeze.status!=='scheduled'||freeze.startAt<=now())return null;
  const pack=record(state,freeze.packId,'pack'), days=freeze.endAt?calendarDays(freeze.startAt,freeze.endAt,studioZone(state)):0;
  const revisedExpiresAt=shiftCalendarDays(pack.expiresAt,-days,studioZone(state));
  const bookings=list(state,'booking').filter(b=>(b.packId===pack.id||b.guestPackId===pack.id)&&['booked','waitlisted','offered'].includes(b.status)&&(state.records.get(b.classId)?.data.start??'')>=revisedExpiresAt).map(b=>({id:b.id,title:state.records.get(b.classId)?.data.title,start:state.records.get(b.classId)?.data.start,booking:b}));
  const charge=freeze.chargeId?state.records.get(freeze.chargeId)?.data:null;
  const feeReversedCents=charge&&!list(state,'charge').some(c=>c.reversesChargeId===charge.id)?charge.amountCents:0;
  const result={freezeId:freeze.id,revisedExpiresAt,feeReversedCents,bookings,basis:JSON.stringify({freeze,pack,bookings,charge,terms:list(state,'recurringTerms').filter(t=>t.currentPackId===pack.id)})};
  return {...result,key:sha256(JSON.stringify(result))};
}
export function withdrawFreeze(tx:Transaction,input:Record<string,unknown>) {
  const freeze=record(tx.state,input.id,'freeze');if(!['owner','front-desk','manager'].includes(tx.who.role))own(tx,freeze.personId);else requireFreezeStaff(tx.state,tx.who,freeze.packId);
  const requestId=text(input.requestId,'requestId',100),reason=tx.who.role!=='member'?text(input.reason,'reason',500):input.reason?text(input.reason,'reason',500):null;
  if(freeze.status==='withdrawn'){insist(freeze.withdrawnBy===tx.who.id&&freeze.withdrawRequestId===requestId&&freeze.withdrawalReason===reason&&freezeKeyMatches(input.withdrawKey,freeze.withdrawKey),'freeze_request_changed',409);return freeze;}
  const preview=freezeWithdrawal(tx.state,freeze);insist(preview&&freezeKeyMatches(input.withdrawKey,preview.key),'freeze_withdrawal_changed',409);tx.future(freeze.startAt);
  const actionId=id();
  for(const item of preview.bookings){const b=record(tx.state,item.id,'booking'),returned=b.status==='booked';if(returned)bookingCredit(tx,b,{type:'restore',credits:1,bookingId:b.id,classId:b.classId,reason:'Freeze withdrawn; original term restored'});
    const after={...b,status:'cancelled',cancellation:'freeze-withdrawal',refunded:returned,feeCents:0,cancelledAt:now(),cancelledBy:tx.who.id,cancelledByRole:tx.who.role};tx.put('booking',after);
    if(b.guestPackId)contractNotice(tx,`freeze-withdraw-guest:${freeze.id}:${b.id}`,b.personId,'Guest booking cancelled after a freeze withdrawal','The host withdrew the scheduled freeze, restoring the original term end. This guest seat is after that end and was cancelled. Its original guest pass was returned or its original studio-balance price was reversed once to the original payer. No cancellation fee, payment or external refund was made.',[b.id]);
    bookingHistory(tx,'cancel',b,after,{reason:'Freeze withdrawn; original term restored',channel:input.channel??'desk'},{parentActionId:actionId});}
  if(preview.feeReversedCents){const charge=record(tx.state,freeze.chargeId,'charge');tx.put('charge',{id:id(),personId:charge.personId,packId:freeze.packId,freezeId:freeze.id,amountCents:-charge.amountCents,reason:'freeze_fee_reversal',reversesChargeId:charge.id,createdAt:now(),createdBy:tx.who.id});}
  const pack=record(tx.state,freeze.packId,'pack');tx.put('pack',{...pack,allowanceExpiresAt:freeze.originalAllowanceExpiresAt??null});
  appendPackEvent(tx,record(tx.state,pack.id,'pack'),{type:'adjust',credits:0,expiresAt:preview.revisedExpiresAt,reason:'Scheduled freeze withdrawn'});moveRecurringRenewal(tx,pack.id,preview.revisedExpiresAt,freeze.id);
  const withdrawn={...freeze,status:'withdrawn',withdrawnAt:now(),withdrawnBy:tx.who.id,withdrawRequestId:requestId,withdrawalReason:reason,withdrawKey:input.withdrawKey,staffActionId:actionId};tx.put('freeze',withdrawn);
  contractNotice(tx,`freeze-withdraw:${freeze.id}`,freeze.personId,'Scheduled freeze withdrawn',`The freeze was withdrawn before it started. $${(preview.feeReversedCents/100).toFixed(2)} fee reversed once; term expiry and next agreed invoice restored to ${preview.revisedExpiresAt}. Previously cancelled bookings stay cancelled. ${preview.bookings.length} new bookings beyond the restored term were cancelled with original funding returned. No payment or refund was sent.`);return withdrawn;
}

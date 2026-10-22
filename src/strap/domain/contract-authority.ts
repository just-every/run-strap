import { localInstant } from '../zone';
import { studioZone } from './pack-credits';
import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';

/** Membership cancellation authority is independent of makeup/household access. */
export function saveContractAuthority(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId), delegate = person(tx.state,input.delegateId), kind = text(input.kind,'kind',30);
  insist(member.role === 'member' && delegate.role === 'member' && member.id !== delegate.id,'invalid_contract_authority');
  insist(['payer','minor-guardian'].includes(kind),'invalid_authority_kind');
  const adultOn = kind === 'minor-guardian' ? text(input.adultOn,'adultOn',10) : null;
  if(adultOn)insist(/^\d{4}-\d\d-\d\d$/.test(adultOn)&&Number.isFinite(Date.parse(adultOn+'T00:00:00Z'))&&new Date(adultOn+'T00:00:00Z').toISOString().slice(0,10)===adultOn,'invalid_adultOn');
  const adultAt=adultOn?new Date(localInstant(adultOn,'00:00',studioZone(tx.state))).toISOString():null;
  if(adultAt){insist(adultAt>now(),'contract_authority_expired',409);tx.future(adultAt);}
  const evidenceReference = text(input.evidenceReference,'evidenceReference',200);
  const prior = list(tx.state,'contractAuthority').find(g => g.personId === member.id && g.delegateId === delegate.id && g.kind === kind && !g.revokedAt);
  if (prior) { insist(prior.evidenceReference === evidenceReference && prior.adultOn === adultOn,'authority_changed',409); return prior; }
  const agreementIds=kind==='payer'?list(tx.state,'recurringTerms').filter(t=>t.personId===member.id&&t.acceptedAt&&t.currentPackId).map(t=>t.id):[];
  insist(kind!=='payer'||agreementIds.length>0,'accepted_recurring_terms_required',409);
  const grant = {agreementIds,id:id(),personId:member.id,delegateId:delegate.id,kind,adultOn,adultAt,evidenceReference,verifiedAt:now(),verifiedBy:tx.who.id,memberAcceptedAt:null,delegateAcceptedAt:null,revokedAt:null};
  tx.put('contractAuthority',grant); return grant;
}
export function acceptContractAuthority(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_required',403);
  const grant = record(tx.state,input.id,'contractAuthority');
  insist(!grant.revokedAt && [grant.personId,grant.delegateId].includes(tx.who.personId),'contract_authority_not_found',404);
  if(grant.kind==='minor-guardian'){insist(grant.adultAt>now(),'contract_authority_expired',409);tx.future(grant.adultAt);}
  person(tx.state,grant.personId); person(tx.state,grant.delegateId);
  const field = tx.who.personId === grant.personId ? 'memberAcceptedAt' : 'delegateAcceptedAt';
  if (grant[field]) return grant;
  const accepted = {...grant,[field]:now(),[field.replace('At','By')]:tx.who.id}; tx.put('contractAuthority',accepted); return accepted;
}
export function revokeContractAuthority(tx: Transaction, input: Record<string,unknown>) {
  const grant = record(tx.state,input.id,'contractAuthority');
  const owner=tx.who.role==='owner'&&tx.who.isOwner,member=tx.who.role==='member';
  insist(owner||member&&(tx.who.personId===grant.delegateId||grant.kind==='payer'&&tx.who.personId===grant.personId),'contract_authority_not_found',404);
  const reason=owner?text(input.reason,'reason',500):null;
  if (grant.revokedAt) return grant;
  const revoked = {...grant,revokedAt:now(),revokedBy:tx.who.id,revocationReason:reason}; tx.put('contractAuthority',revoked); return revoked;
}
export const activeContractAuthorities = (state: State, personId: string) => list(state,'contractAuthority').filter(g => g.personId === personId && !g.revokedAt && g.delegateAcceptedAt && (g.kind === 'payer' ? !!g.memberAcceptedAt : g.kind === 'minor-guardian' && g.adultAt>now()) && state.people.some(p => p.id === g.delegateId && p.active && !p.erasedAt));
export function canCancelContract(state: State, who: Actor, personId: string, termsId?:string) {
  if(!state.people.some(p=>p.id===personId&&p.active&&!p.erasedAt))return false;
  return who.role === 'owner' && who.isOwner || who.role === 'member' && (who.personId === personId || activeContractAuthorities(state,personId).some(g => g.delegateId === who.personId && (g.kind==='minor-guardian'||!!termsId&&g.agreementIds?.includes(termsId))));
}
export function authorizeContractCancellation(tx:Transaction,personId:string,termsId:string){
  insist(canCancelContract(tx.state,tx.who,personId,termsId),'contract_not_found',404);
  if(tx.who.role==='member'&&tx.who.personId!==personId){const grant=activeContractAuthorities(tx.state,personId).find(g=>g.delegateId===tx.who.personId&&(g.kind==='minor-guardian'||g.agreementIds?.includes(termsId)));insist(grant,'contract_not_found',404);if(grant.kind==='minor-guardian')tx.future(grant.adultAt);}
}
export const contractRecipients = (state: State, personId: string, termsId:string) => [...new Set([personId,...activeContractAuthorities(state,personId).filter(g => g.kind === 'payer'&&g.agreementIds?.includes(termsId)).map(g => g.delegateId)])];
export function contractAuthoritySnapshot(state: State, who: Actor) {
  return list(state,'contractAuthority').filter(g => who.role === 'owner' && who.isOwner || who.role === 'member' && [g.personId,g.delegateId].includes(who.personId)).map(g => who.role === 'owner' ? g : {id:g.id,personId:g.personId,participantName:person(state,g.personId,false).name,delegateName:person(state,g.delegateId,false).name,delegateId:g.delegateId,agreementIds:g.agreementIds,agreements:(g.agreementIds??[]).flatMap((id:string)=>{const t=state.records.get(id)?.data;return t?[{amountCents:t.amountCents,intervalMonths:t.intervalMonths,firstDueAt:t.firstDueAt,timeZone:t.timeZone}]:[];}),kind:g.kind,adultOn:g.adultOn,adultAt:g.adultAt,memberAcceptedAt:g.memberAcceptedAt,delegateAcceptedAt:g.delegateAcceptedAt,revokedAt:g.revokedAt});
}

export function launchContractAuthority(tx:Transaction,input:Record<string,unknown>){humanOwner(tx.who);text(input.requestId,'requestId',100);const grant=record(tx.state,input.id,'contractAuthority');return {id:id(),personId:grant.personId,previewId:grant.id,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fpacks%23cancellations'};}

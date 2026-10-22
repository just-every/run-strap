import { humanOwner, id, insist, list, now, person, record, text, type Actor, type State } from './types';
import type { Transaction } from './store';
import { guardianAuthorityEndsAt, guardianDateFacts } from './contract-authority-age';

/** Membership cancellation authority is independent of makeup/household access. */
export function saveContractAuthority(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId), delegate = person(tx.state,input.delegateId), kind = text(input.kind,'kind',30);
  insist(member.role === 'member' && delegate.role === 'member' && member.id !== delegate.id,'invalid_contract_authority');
  insist(['payer','minor-guardian'].includes(kind),'invalid_authority_kind');
  const evidenceReference = text(input.evidenceReference,'evidenceReference',200);
  const prior = list(tx.state,'contractAuthority').find(g => g.personId === member.id && g.delegateId === delegate.id && g.kind === kind && !g.revokedAt);
  const dates = kind === 'minor-guardian' ? guardianDateFacts(tx.state,member.id,input) : {adultOn:null,adultAt:null};
  if (prior) {
    insist(prior.evidenceReference === evidenceReference && prior.adultOn === dates.adultOn,'authority_changed',409);
    if (kind === 'minor-guardian') {
      const facts = dates as ReturnType<typeof guardianDateFacts>;
      insist((prior.birthOn ?? null) === facts.birthOn,'authority_changed',409);
      if (prior.emancipatedOn) {
        insist(prior.emancipatedOn === facts.emancipatedOn && prior.emancipationEvidenceReference === facts.emancipationEvidenceReference,'authority_changed',409);
      } else if (facts.emancipatedOn) {
        // Recording emancipation only shortens an existing grant, including immediately.
        const updated = {...prior,...facts,adultAt:prior.adultAt,emancipationVerifiedAt:now(),emancipationVerifiedBy:tx.who.id};
        updated.authorityEndsAt = guardianAuthorityEndsAt(updated)!;
        if (updated.authorityEndsAt > now()) tx.future(updated.authorityEndsAt);
        tx.put('contractAuthority',updated); return updated;
      }
      const endsAt = guardianAuthorityEndsAt(prior);
      insist(endsAt && endsAt > now(),'contract_authority_expired',409); tx.future(endsAt);
    }
    return prior;
  }
  if (kind === 'minor-guardian') {
    const endsAt = (dates as ReturnType<typeof guardianDateFacts>).authorityEndsAt;
    insist(endsAt > now(),'contract_authority_expired',409); tx.future(endsAt);
  }
  const agreementIds=kind==='payer'?list(tx.state,'recurringTerms').filter(t=>t.personId===member.id&&t.acceptedAt&&t.currentPackId).map(t=>t.id):[];
  insist(kind!=='payer'||agreementIds.length>0,'accepted_recurring_terms_required',409);
  const grant = {agreementIds,id:id(),personId:member.id,delegateId:delegate.id,kind,...dates,evidenceReference,verifiedAt:now(),verifiedBy:tx.who.id,memberAcceptedAt:null,delegateAcceptedAt:null,revokedAt:null};
  tx.put('contractAuthority',grant); return grant;
}
export function acceptContractAuthority(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_required',403);
  const row = tx.state.records.get(text(input.id,'id',100));
  insist(row?.kind === 'contractAuthority','contract_authority_not_found',404);
  const grant = row.data;
  insist(!grant.revokedAt && [grant.personId,grant.delegateId].includes(tx.who.personId),'contract_authority_not_found',404);
  insist(grant.kind!=='payer'||tx.who.personId!==grant.delegateId||grant.memberAcceptedAt,'contract_authority_not_found',404);
  if(grant.kind==='minor-guardian'){const endsAt=guardianAuthorityEndsAt(grant);insist(endsAt&&endsAt>now(),'contract_authority_expired',409);tx.future(endsAt);}
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
export const activeContractAuthorities = (state: State, personId: string) => list(state,'contractAuthority').filter(g => g.personId === personId && !g.revokedAt && g.delegateAcceptedAt && (g.kind === 'payer' ? !!g.memberAcceptedAt : g.kind === 'minor-guardian' && (guardianAuthorityEndsAt(g) ?? '')>now()) && state.people.some(p => p.id === g.delegateId && p.active && !p.erasedAt));
export function canCancelContract(state: State, who: Actor, personId: string, termsId?:string) {
  if(!state.people.some(p=>p.id===personId&&p.active&&!p.erasedAt))return false;
  return who.role === 'owner' && who.isOwner || who.role === 'member' && (who.personId === personId || activeContractAuthorities(state,personId).some(g => g.delegateId === who.personId && (g.kind==='minor-guardian'||!!termsId&&g.agreementIds?.includes(termsId))));
}
export function authorizeContractCancellation(tx:Transaction,personId:string,termsId:string){
  insist(canCancelContract(tx.state,tx.who,personId,termsId),'contract_not_found',404);
  if(tx.who.role==='member'&&tx.who.personId!==personId){const grant=activeContractAuthorities(tx.state,personId).find(g=>g.delegateId===tx.who.personId&&(g.kind==='minor-guardian'||g.agreementIds?.includes(termsId)));insist(grant,'contract_not_found',404);if(grant.kind==='minor-guardian')tx.future(guardianAuthorityEndsAt(grant)!);}
}
export const contractRecipients = (state: State, personId: string, termsId:string) => [...new Set([personId,...activeContractAuthorities(state,personId).filter(g => g.kind === 'payer'&&g.agreementIds?.includes(termsId)).map(g => g.delegateId)])];
export function contractAuthoritySnapshot(state: State, who: Actor) {
  return list(state,'contractAuthority').filter(g => who.role === 'owner' && who.isOwner || who.role === 'member' && (g.personId===who.personId||g.delegateId===who.personId&&(g.kind!=='payer'||g.memberAcceptedAt))).map(g => {
    const authorityEndsAt = guardianAuthorityEndsAt(g);
    const dates = {birthOn:g.birthOn??null,majorityRegion:g.majorityRegion??null,majorityAge:g.majorityAge??null,majorityRuleVerified:g.majorityRuleVerified??false,majorityDateSource:g.majorityDateSource??'verified-adult-date',adultOn:g.adultOn,adultAt:g.adultAt,emancipatedOn:g.emancipatedOn??null,emancipatedAt:g.emancipatedAt??null,authorityEndsOn:g.authorityEndsOn??g.adultOn,authorityEndsAt,expiredAt:authorityEndsAt&&authorityEndsAt<=now()?authorityEndsAt:null};
    if (who.role === 'owner') return {...g,...dates};
    return {id:g.id,personId:g.personId,participantName:person(state,g.personId,false).name,delegateName:person(state,g.delegateId,false).name,delegateId:g.delegateId,agreementIds:g.agreementIds,agreements:(g.agreementIds??[]).flatMap((id:string)=>{const t=state.records.get(id)?.data;return t?[{amountCents:t.amountCents,intervalMonths:t.intervalMonths,firstDueAt:t.firstDueAt,timeZone:t.timeZone}]:[];}),kind:g.kind,...dates,memberAcceptedAt:g.memberAcceptedAt,delegateAcceptedAt:g.delegateAcceptedAt,revokedAt:g.revokedAt};
  });
}

export function launchContractAuthority(tx:Transaction,input:Record<string,unknown>){humanOwner(tx.who);text(input.requestId,'requestId',100);const grant=record(tx.state,input.id,'contractAuthority');return {id:id(),personId:grant.personId,previewId:grant.id,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fpacks%23cancellations'};}

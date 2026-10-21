import { countsCredits } from './entitlements';
import { createLead } from './leads';
import { humanOwner, insist, integer, list, now, record, text, type Actor, type State } from './types';
import type { Transaction } from './store';

const day = 86_400_000;
function number(query: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const value = query.get(name);
  insist(value === null || /^\d+$/.test(value),`invalid_${name}`);
  return integer(value === null ? fallback : Number(value),name,min,max);
}

/** RPT-007 partial: current finite credit packs only; no inferred consent or cash value. */
export function renewalWorklist(state: State, who: Actor, query: URLSearchParams) {
  humanOwner(who);
  const days = number(query,'days',30,1,366), lowCredits = number(query,'lowCredits',1,0,10_000);
  const asOf = now(), through = new Date(Date.parse(asOf)+days*day).toISOString();
  const changes = list(state,'planChange'), packs = list(state,'pack');
  const renewed = new Set([
    ...changes.filter(c => c.mode === 'renewal' && ['accepted','applied'].includes(c.status)).map(c => c.packId),
    ...packs.filter(p => p.renewedFromPackId).map(p => p.renewedFromPackId),
  ]);
  const rows = packs.flatMap(pack => {
    const member = state.people.find(p => p.id === pack.personId && p.role === 'member' && !p.erasedAt);
    if (!member || !countsCredits(pack) || pack.expiresAt <= asOf || renewed.has(pack.id)) return [];
    const reasons = [pack.expiresAt <= through ? 'expiring' : null,pack.remaining <= lowCredits ? 'low-credits' : null].filter((v): v is string => !!v);
    if (!reasons.length) return [];
    const visits = list(state,'booking').filter(b => b.personId === member.id && b.status === 'booked' && b.attendance === 'attended')
      .map(b => state.records.get(b.classId)?.data.start as string | undefined).filter((v): v is string => !!v && v <= asOf).sort();
    const followup = state.records.get('renewal-followup:'+pack.id)?.data;
    const lead = followup ? state.records.get(followup.leadId)?.data : null;
    return [{packId:pack.id,personId:member.id,member:member.name,plan:pack.entitlement?.name ?? 'Class credits',
      expiresAt:pack.expiresAt,remainingCredits:pack.remaining,remainingValueCents:null,lastVisit:visits.at(-1) ?? null,
      renewalStatus:'not-recorded',contactPermission:'unavailable',reasons,
      followup:lead ? {leadId:lead.id,ownerId:lead.ownerId,stage:lead.stage,nextAction:lead.nextAction,dueAt:lead.dueAt} : null,
      basis:JSON.stringify([state.version,pack.id,pack.creditRevision ?? 0,pack.expiresAt,pack.remaining])}];
  }).sort((a,b) => a.expiresAt.localeCompare(b.expiresAt) || a.packId.localeCompare(b.packId));
  return {asOf,through,days,lowCredits,rows,coverage:'Finite credit packs only; other plan kinds, monetary remaining value and marketing permission are unavailable.'};
}

export const renewalColumns = ['packId','personId','member','plan','expiresAt','remainingCredits','remainingValueCents','lastVisit','renewalStatus','contactPermission','reasons','followup'];

export function renewalCsv(report: ReturnType<typeof renewalWorklist>) {
  const quote = (value: string) => '"'+value.replace(/"/g,'""')+'"';
  // As in the portable exit, JSON-valued cells preserve types and keep formula-shaped names inert.
  return [renewalColumns.map(quote).join(','),...report.rows.map(row => renewalColumns.map(key => quote(JSON.stringify(row[key as keyof typeof row]))).join(','))].join('\r\n')+'\r\n';
}

/** An internal assigned LEAD-002 task, never permission to contact or send a sequence. */
export async function createRenewalFollowup(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const pack = record(tx.state,input.packId,'pack');
  const ownerId = text(input.ownerId,'ownerId',100), nextAction = text(input.nextAction,'nextAction',500);
  const dueAt = text(input.dueAt,'dueAt',50);
  const prior = tx.state.records.get('renewal-followup:'+pack.id)?.data;
  const requestBasis = JSON.stringify({ownerId,nextAction,dueAt});
  if (prior) {
    insist(prior.requestBasis === requestBasis,'renewal_followup_exists',409);
    return {packId:pack.id,leadId:prior.leadId};
  }
  const days = integer(input.days ?? 30,'days',1,366), lowCredits = integer(input.lowCredits ?? 1,'lowCredits',0,10_000);
  const row = renewalWorklist(tx.state,tx.who,new URLSearchParams({days:String(days),lowCredits:String(lowCredits)})).rows.find(r => r.packId === pack.id);
  insist(row,'pack_not_in_renewal_worklist',409);
  insist(input.basis === row.basis,'renewal_worklist_changed',409);
  const lead = await createLead(tx,{personId:pack.personId,ownerId,nextAction,dueAt,requestId:'renewal:'+pack.id});
  tx.put('renewalFollowup',{id:'renewal-followup:'+pack.id,personId:pack.personId,packId:pack.id,leadId:lead.id,requestBasis,
    createdAt:now(),createdBy:tx.who.id,sourceBasis:row.basis});
  return {packId:pack.id,leadId:lead.id};
}

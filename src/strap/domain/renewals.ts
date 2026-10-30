import { preferencesOf, permission } from './preferences';
import { countsCredits } from './entitlements';
import { unusedPrepaid } from './cancellation-value';
import { createLead } from './leads';
import { humanOwner, insist, integer, list, now, record, text, type Actor, type State } from './types';
import type { Transaction } from './store';

const day = 86_400_000;
function number(query: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const value = query.get(name);
  insist(value === null || /^\d+$/.test(value),`invalid_${name}`);
  return integer(value === null ? fallback : Number(value),name,min,max);
}

/** Native term events share one row per pack; payment evidence alone supplies value. */
export function renewalWorklist(state: State, who: Actor, query: URLSearchParams) {
  humanOwner(who);
  return renewalCandidates(state,query);
}
export function renewalCandidates(state: State, query: URLSearchParams) {
  const days = number(query,'days',30,1,366), lowCredits = number(query,'lowCredits',1,0,10_000);
  const asOf = now(), through = new Date(Date.parse(asOf)+days*day).toISOString();
  const changes = list(state,'planChange'), packs = list(state,'pack');
  const renewed = new Set([
    ...changes.filter(c => c.mode === 'renewal' && ['accepted','applied'].includes(c.status)).map(c => c.packId),
    ...packs.filter(p => p.renewedFromPackId).map(p => p.renewedFromPackId),
  ]);
  const rows = packs.flatMap(pack => {
    const member = state.people.find(p => p.id === pack.personId && p.role === 'member' && !p.erasedAt);
    if (!member || pack.expiresAt <= asOf || renewed.has(pack.id)) return [];
    const terms = list(state,'recurringTerms').find(t => (t.currentPackId ?? t.packId) === pack.id && t.acceptedAt && ['active','stopped','cancellation_scheduled'].includes(t.status));
    const cancellation = list(state,'contractCancellation').find(c => c.packId === pack.id && c.status === 'scheduled');
    const freeze = list(state,'freeze').filter(f => f.packId === pack.id && ['scheduled','active'].includes(f.status) && f.endAt > asOf && f.endAt <= through).sort((a,b) => a.endAt.localeCompare(b.endAt))[0];
    const kind = cancellation ? cancellation.mode === 'term_end' ? 'canceling-renewal' : 'termination' : terms?.status === 'stopped' ? 'canceling-renewal' : pack.introOfferId ? 'intro' : countsCredits(pack) ? 'pack' : 'fixed-term';
    const endAt = cancellation?.effectiveAt ?? pack.expiresAt;
    const reasons = [endAt > asOf && endAt <= through && terms?.status !== 'active' ? 'expiring' : null,
      countsCredits(pack) && pack.remaining <= lowCredits ? 'low-credits' : null,freeze ? 'freeze-ending' : null].filter((v): v is string => !!v);
    if (!reasons.length) return [];
    const visits = list(state,'booking').filter(b => b.personId === member.id && b.status === 'booked' && b.attendance === 'attended')
      .map(b => state.records.get(b.classId)?.data.start as string | undefined).filter((v): v is string => !!v && v <= asOf).sort();
    const followup = state.records.get('renewal-followup:'+pack.id)?.data;
    const lead = followup ? state.records.get(followup.leadId)?.data : null;
    const value = unusedPrepaid(state,pack,asOf);
    return [{packId:pack.id,personId:member.id,member:member.name,plan:pack.entitlement?.name ?? 'Class credits',kind,
      expiresAt:reasons.includes('expiring') || reasons.includes('low-credits') ? endAt : freeze.endAt,
      termExpiresAt:pack.expiresAt,freezeEndsAt:freeze?.endAt ?? null,terminationId:cancellation?.id ?? null,
      reasonCode:cancellation?.mode === 'early' ? cancellation.reasonCode ?? 'other' : null,
      reasonLabel:cancellation?.mode === 'early' ? cancellation.reasonLabel ?? cancellation.reasonCode ?? 'other' : null,
      remainingCredits:countsCredits(pack) ? pack.remaining : null,remainingValueCents:value.amountCents,
      valueBasis:{paidCents:value.paidCents,needsAllocation:value.needsAllocation,method:'unused receipt-allocated elapsed access; half-up cents'},lastVisit:visits.at(-1) ?? null,
      sequenceEnrollments:list(state,'marketingMessage').filter(m=>m.packId===pack.id).map(m=>({id:m.id,sequenceId:m.sequenceId,status:m.status,channel:m.channel})),
      renewalStatus:terms?.status ?? 'not-recorded',contactPermission:Object.fromEntries(['email','sms','inApp'].map(channel => [channel,permission(state,member.id,channel as 'email'|'sms'|'inApp') ?? 'confirmed'])),reasons,
      followup:lead ? {leadId:lead.id,ownerId:lead.ownerId,stage:lead.stage,nextAction:lead.nextAction,dueAt:lead.dueAt} : null,
      basis:JSON.stringify([state.version,pack.id,pack.creditRevision ?? 0,pack.expiresAt,pack.remaining])}];
  }).sort((a,b) => a.expiresAt.localeCompare(b.expiresAt) || a.packId.localeCompare(b.packId));
  return {asOf,through,days,lowCredits,rows,coverage:'Native finite packs, fixed-term visit/unlimited plans, intro offers, stopped invoice renewals, scheduled terminations and freeze endings. Value is unused receipt-allocated prepaid access at the report time, rounded half-up; an unallocated eligible receipt makes it unavailable. This is not a refund quote or collection. Channel-specific permission and approved native renewal sequence enrollment are recorded. Native in-app review is explicit; SMS/email delivery and provider-autopay endings remain unavailable.'};
}

export const renewalColumns = ['packId','personId','member','plan','expiresAt','remainingCredits','remainingValueCents','kind','termExpiresAt','freezeEndsAt','terminationId','reasonCode','reasonLabel','valueBasis','sequenceEnrollments','lastVisit','renewalStatus','contactPermission','reasons','followup'];

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

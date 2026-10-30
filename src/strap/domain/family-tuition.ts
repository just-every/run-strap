import { humanOwner, id, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent } from './pack-credits';
import { localDate, localInstant } from '../zone';
import { studioSettings } from './studio';

const month = (value: unknown) => {
  const m = text(value,'month',7);
  insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m >= '2000-01' && m <= '2199-12','invalid_month'); return m;
};
const following = (m: string) => { const [y,n] = m.split('-').map(Number); return n === 12 ? `${y+1}-01` : `${y}-${String(n+1).padStart(2,'0')}`; };
const currentMonth = (state: State) => localDate(now(),studioSettings(state)?.timeZone ?? 'UTC').slice(0,7);
const home = (state: State,key: unknown) => record(state,key,'household');
function facts(state: State, plan: RecordData) {
  const household = home(state,plan.householdId);
  return JSON.stringify({plan,household,people:[plan.payerId,...plan.rows.map((r: RecordData) => r.personId)].map(key => state.people.some(p=>p.id===key&&p.erasedAt)?{id:key,erased:true}:person(state,key,false))});
}
/** No automatic collection, no retroactive repricing, and a payer personally accepts each exact monthly bill. */
export function saveFamilyTuition(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const household = home(tx.state,input.householdId), payer = person(tx.state,household.payerId);
  insist(payer.email,'payer_needs_sign_in_email');
  const startsMonth = month(input.startsMonth), endsMonth = month(input.endsMonth);
  insist(startsMonth >= currentMonth(tx.state) && endsMonth > startsMonth,'invalid_tuition_term');
  insist(!list(tx.state,'familyTuition').some(p => p.householdId === household.id && p.startsMonth < endsMonth && p.endsMonth > startsMonth),'tuition_term_overlaps',409);
  const discountBps = integer(input.discountBps,'discountBps',0,10000);
  insist(Array.isArray(input.rows) && input.rows.length > 0 && input.rows.length <= 20,'invalid_tuition_rows');
  const rows = input.rows.map((value: any) => {
    insist(value && typeof value === 'object','invalid_tuition_row');
    const member = person(tx.state,value.personId); insist(member.role === 'member' && household.participantIds.includes(member.id),'household_participant_required');
    return {personId:member.id,name:member.name,amountCents:integer(value.amountCents,'amountCents',0,100_000_000),credits:integer(value.credits,'credits',1,10000),endsMonth};
  });
  insist(new Set(rows.map(r => r.personId)).size === rows.length,'duplicate_tuition_participant');
  const service = text(input.service,'service',160);
  const plan = {id:id(),householdId:household.id,payerId:payer.id,personId:payer.id,name:text(input.name,'tuition_name',120),startsMonth,endsMonth,rows,discountBps,service,
    timeZone:studioSettings(tx.state)?.timeZone ?? 'UTC',locationId:'studio',revision:1,createdAt:now(),createdBy:tx.who.id,
    policy:'Two or more enrolled household participants: the sibling percentage applies to every participant. Round each discount to the nearest cent, half up. No stacking. Each month needs the payer’s exact acceptance; nothing is collected automatically.'};
  tx.put('familyTuition',plan); return plan;
}
export function previewFamilyBill(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const plan = record(tx.state,input.id,'familyTuition'), period = month(input.month), household = home(tx.state,plan.householdId);
  insist(period >= currentMonth(tx.state) && period >= plan.startsMonth && period < plan.endsMonth,'tuition_month_outside_term',409);
  insist(household.payerId === plan.payerId,'tuition_payer_changed',409);
  person(tx.state,plan.payerId);
  insist(!list(tx.state,'familyInvoice').some(b => b.planId === plan.id && b.month === period),'tuition_month_already_billed',409);
  const active = plan.rows.filter((r: RecordData) => period < r.endsMonth);
  insist(active.length,'no_tuition_participants',409);
  for(const row of active) {person(tx.state,row.personId);insist(household.participantIds.includes(row.personId),'tuition_household_changed',409);}
  const discountBps = active.length >= 2 ? plan.discountBps : 0;
  const rows = active.map((r: RecordData) => { const discountCents = Math.floor((r.amountCents*discountBps+5000)/10000); return {...r,discountCents,netCents:r.amountCents-discountCents}; });
  const preview = {id:id(),planId:plan.id,householdId:plan.householdId,personId:plan.payerId,payerId:plan.payerId,name:plan.name,month:period,rows,discountBps,
    amountCents:rows.reduce((n: number,r: RecordData) => n+r.netCents,0),termStartAt:localInstant(period+'-01','00:00',plan.timeZone),termEndAt:localInstant(following(period)+'-01','00:00',plan.timeZone),
    basis:facts(tx.state,plan),policy:plan.policy,status:'preview',createdAt:now(),createdBy:tx.who.id};
  const saved = {...preview,key:id()};tx.put('familyBillPreview',saved); return saved;
}
export function launchFamilyAcceptance(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const preview = record(tx.state,input.id,'familyBillPreview');
  insist(preview.status === 'preview','tuition_preview_closed',409);
  return {id:preview.id,personId:preview.payerId,status:'member_action_required',url:'/app/tuition#bill-'+preview.id};
}
export function acceptFamilyBill(tx: Transaction,input: Record<string,unknown>) {
  insist(tx.who.role === 'member','payer_acceptance_required',403);
  const preview = record(tx.state,input.id,'familyBillPreview');
  insist(preview.payerId === tx.who.personId,'familyBillPreview_not_found',404);
  insist(input.key === preview.key && input.confirm === true,'tuition_exact_acceptance_required',409);
  const prior = list(tx.state,'familyInvoice').find(b => b.previewId === preview.id); if(prior) return prior;
  const plan = record(tx.state,preview.planId,'familyTuition');
  insist(preview.status === 'preview' && facts(tx.state,plan) === preview.basis,'tuition_preview_changed',409);
  insist(preview.month >= currentMonth(tx.state) && preview.termEndAt > now(),'tuition_preview_expired',409);
  insist(!list(tx.state,'familyInvoice').some(b => b.planId === plan.id && b.month === preview.month),'tuition_month_already_billed',409);
  tx.future(preview.termEndAt);
  const invoiceId = id(), at = now();
  const allocations = preview.rows.map((row: RecordData) => {
    const pack = {id:id(),personId:row.personId,locationId:plan.locationId,eligibleLocations:[plan.locationId],eligibleServices:[plan.service],priorityBooking:false,
      credits:row.credits,remaining:0,creditLedgerVersion:1,creditRevision:0,amountCents:row.netCents,termStartAt:preview.termStartAt,expiresAt:preview.termEndAt,
      familyInvoiceId:invoiceId,createdAt:at};
    tx.put('pack',pack);appendPackEvent(tx,pack,{type:'grant',credits:row.credits});
    const charge = {id:id(),personId:preview.payerId,forPersonId:row.personId,packId:pack.id,locationId:plan.locationId,familyInvoiceId:invoiceId,kind:'family-tuition',amountCents:row.netCents,createdAt:at};
    tx.put('charge',charge);return {...row,packId:pack.id,chargeId:charge.id};
  });
  const invoice = {id:invoiceId,planId:plan.id,previewId:preview.id,householdId:plan.householdId,personId:preview.payerId,payerId:preview.payerId,month:preview.month,
    name:plan.name,rows:allocations,amountCents:preview.amountCents,termStartAt:preview.termStartAt,termEndAt:preview.termEndAt,policy:preview.policy,
    acceptedAt:at,acceptedBy:tx.who.id,acceptance:{key:preview.key,amountCents:preview.amountCents,rows:preview.rows,policy:preview.policy},collection:'external-receipt-only'};
  tx.put('familyInvoice',invoice);tx.put('familyBillPreview',{...preview,status:'accepted',invoiceId}); return invoice;
}
export function withdrawFamilyParticipant(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const plan = record(tx.state,input.id,'familyTuition'), effectiveMonth = month(input.effectiveMonth);
  insist(input.revision === plan.revision,'tuition_plan_changed',409);
  const row = plan.rows.find((r: RecordData) => r.personId === input.personId);
  insist(row && effectiveMonth >= currentMonth(tx.state) && effectiveMonth >= plan.startsMonth && effectiveMonth < row.endsMonth,'invalid_tuition_withdrawal');
  insist(!list(tx.state,'familyInvoice').some(b => b.planId === plan.id && b.month >= effectiveMonth),'tuition_period_already_billed',409);
  const saved = {...plan,rows:plan.rows.map((r: RecordData) => r.personId === row.personId ? {...r,endsMonth:effectiveMonth} : r),revision:plan.revision+1};
  tx.put('familyTuition',saved);
  const event = {id:id(),planId:plan.id,personId:row.personId,payerId:plan.payerId,effectiveMonth,reason:text(input.reason,'reason',500),at:now(),actorId:tx.who.id};
  tx.put('familyTuitionWithdrawal',event); return {...event,revision:saved.revision};
}
export function familyTuitionSnapshot(state: State,who: Actor) {
  const visible = (r: RecordData) => who.role === 'owner' || who.role === 'member' && r.payerId === who.personId;
  const plans = list(state,'familyTuition').filter(visible);
  return {plans,previews:list(state,'familyBillPreview').filter(visible).map(r => ({...Object.fromEntries(Object.entries(r).filter(([key]) => who.role === 'owner' || key !== 'basis')),stale:r.status === 'preview' && (r.month < currentMonth(state) || facts(state,record(state,r.planId,'familyTuition')) !== r.basis)})),
    invoices:list(state,'familyInvoice').filter(visible),withdrawals:list(state,'familyTuitionWithdrawal').filter(visible)};
}

import { unusedPrepaid } from './cancellation-value';
import { contractRegion } from './contract-copies';
import { countsCredits } from './entitlements';
import { studioSettings } from './studio';
import { humanOwner, insist, integer, list, now, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';

export interface CoolingRefundOptions {
  regions?: string[];
  policy?: RecordData;
  /** All receipt-bearing packs in the cancelled agreement; renewal rights pass only their pack. */
  packIds?: string[];
}
type Fraction = { n: bigint; d: bigint };
const add = (a: Fraction, b: Fraction): Fraction => ({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
const rounded = (n: bigint, d: bigint) => Number((2n*n+d)/(2n*d));
const zero = (): Fraction => ({n:0n,d:1n});

/** Immutable evidence of the fair-market value of an actually attended service. */
export function recordCoolingServiceValue(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const booking = record(tx.state,input.bookingId,'booking');
  insist(booking.status==='booked' && booking.attendance==='attended' && booking.packId,'attended_pack_booking_required',409);
  const pack = record(tx.state,booking.packId,'pack');
  const amountCents = integer(input.amountCents,'amountCents',0,100_000_000), evidenceReference = text(input.evidenceReference,'evidenceReference',200);
  const key = `cooling-service:${booking.id}`, prior = tx.state.records.get(key)?.data;
  if (prior) {
    insist(prior.bookingId===booking.id && prior.packId===pack.id && prior.amountCents===amountCents && prior.evidenceReference===evidenceReference,'cooling_service_value_changed',409);
    return prior;
  }
  const value = {id:key,personId:booking.personId,packId:pack.id,bookingId:booking.id,amountCents,evidenceReference,createdBy:tx.who.id,createdAt:now()};
  tx.put('coolingServiceValue',value);return value;
}

/** Complete local clock days, so a DST change cannot turn one calendar day into zero or two. */
function completeDays(startAt: string, endAt: string, zone: string) {
  const format = new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const wall = (at: string) => {
    const p = Object.fromEntries(format.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
    return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second,new Date(at).getUTCMilliseconds());
  };
  return Math.max(0,Math.floor((wall(endAt)-wall(startAt))/86_400_000));
}

function attended(state: State, pack: RecordData, at: string) {
  const start = pack.termStartAt ?? pack.createdAt, end = pack.allowanceExpiresAt ?? pack.expiresAt;
  return list(state,'booking').filter(b=>b.packId===pack.id && b.attendance==='attended' && (!b.checkedInAt || b.checkedInAt<=at)).filter(b=>{
    const entry = state.records.get(b.classId)?.data;
    return entry && entry.start>=start && entry.start<end && entry.start<=at;
  });
}

function florida(state: State, pack: RecordData, at: string, zone: string) {
  const startAt = pack.termStartAt ?? pack.createdAt, endAt = pack.allowanceExpiresAt ?? pack.expiresAt;
  const totalPriceCents = pack.amountCents+(pack.initiationFeeCents ?? 0);
  const sessions = countsCredits(pack) && Number.isSafeInteger(pack.credits) && pack.credits>0 ? pack.credits : null;
  const rendered = attended(state,pack,at).length;
  const durationDays = completeDays(startAt,endAt,zone), elapsedDays = Math.min(durationDays,completeDays(startAt,at,zone));
  const denominator = sessions ?? durationDays, numerator = sessions ? Math.min(sessions,rendered) : elapsedDays;
  return {value:denominator>0 ? {n:BigInt(totalPriceCents)*BigInt(numerator),d:BigInt(denominator)} : zero(),
    facts:{packId:pack.id,totalPriceCents,method:sessions?'recorded finite sessions':'complete local calendar days',durationDays,elapsedDays,sessions,renderedSessions:rendered}};
}

/** A valuation only: receipt allocation remains mandatory and no balance or payment is changed. */
export function coolingRefund(state: State, pack: RecordData, effectiveAt: string, options: CoolingRefundOptions = {}) {
  const ids = new Set([pack.id,...(options.packIds ?? [])]);
  const packs = [...ids].map(packId=>packId===pack.id ? pack : state.records.get(packId)?.data).filter((p): p is RecordData=>!!p);
  const values = packs.map(p=>({pack:p,value:unusedPrepaid(state,p,effectiveAt)}));
  const allocations = list(state,'contractPrepayment').filter(a=>ids.has(a.packId));
  const paidCents = allocations.reduce((n,a)=>n+a.amountCents,0), needsAllocation = values.some(v=>v.value.needsAllocation);
  const studio = studioSettings(state), zone = studio?.timeZone ?? 'UTC';
  const regions = [...new Set((options.regions ?? [studio?.address?.region,contractRegion(state,pack.personId)].filter((r):r is string=>!!r)).map(r=>r.toUpperCase()))].sort();
  const policy = options.policy ?? state.records.get('cancellation-policy')?.data;
  const enabled = policy?.coolingDeductions ?? {};
  const rules: RecordData[] = [];
  let deduction = zero(), kind = 'cooling-full';
  const fullRequired = !regions.length || regions.some(r=>!['GA','FL','CA'].includes(r) || enabled[r]!==true);
  if (fullRequired) {
    rules.push({id:'full-refund',regions,explanation:'Full receipt-backed refund: a governing state requires it, its deduction is not enabled, or its permitted deduction is unverified.'});
  } else {
    kind = 'cooling-deduction';
    let selected: Fraction | null = null;
    for (const region of regions) {
      let candidate = zero();
      if (region==='GA') {
        const bookingIds = packs.flatMap(p=>attended(state,p,effectiveAt).map(b=>b.id));
        const valuations = list(state,'coolingServiceValue').filter(v=>ids.has(v.packId) && bookingIds.includes(v.bookingId));
        const valueCents = valuations.reduce((n,v)=>n+v.amountCents,0), deductionCents = Math.min(10_000,valueCents);
        candidate={n:BigInt(deductionCents),d:1n};
        rules.push({id:'GA',bookingIds,valuationIds:valuations.map(v=>v.id),valueCents,capCents:10_000,valuationAvailable:valuations.length>0,deductionCents,
          explanation:valuations.length?'Recorded fair-market values of attended services, capped at $100. Document preparation is excluded.':'No recorded fair-market valuation of received services; no deduction. Document preparation is excluded.'});
      } else if (region==='FL') {
        const calculations = packs.map(p=>florida(state,p,effectiveAt,zone));
        candidate = calculations.reduce((n,c)=>add(n,c.value),zero());
        rules.push({id:'FL',days:calculations.map(c=>c.facts),explanation:'Total agreement price divided by recorded finite sessions or complete local term days, times attended sessions or complete elapsed days.'});
      } else {
        candidate = values.reduce((n,{value})=>add(n,{n:BigInt(value.paidCents)*BigInt(value.formula.durationMs-value.formula.unusedMs),d:BigInt(value.formula.durationMs)}),zero());
        rules.push({id:'CA',terms:values.map(({pack:p,value})=>({packId:p.id,...value.formula})),explanation:'Receipt-backed pro-rata time made available, using the existing access-time calculation and excluding confirmed freezes.'});
      }
      if (selected===null || candidate.n*selected.d<selected.n*candidate.d) selected=candidate;
    }
    deduction=selected ?? zero();
  }
  const paid = BigInt(paidCents), retained = deduction.n>paid*deduction.d ? paid*deduction.d : deduction.n;
  const knownUnusedCents = rounded(paid*deduction.d-retained,deduction.d);
  // Round the total once, then distribute cumulative shares; the final payer receives the exact remainder.
  let cumulative=0, distributed=0;
  const payers=[...new Set(allocations.map(a=>a.payerId))].sort().map(payerId=>{
    const prepaidCents=allocations.filter(a=>a.payerId===payerId).reduce((n,a)=>n+a.amountCents,0);
    cumulative+=prepaidCents;
    const next=paidCents ? rounded(BigInt(cumulative)*BigInt(knownUnusedCents),paid) : 0;
    const unusedCents=next-distributed;distributed=next;
    return {payerId,prepaidCents,unusedCents};
  });
  return {paidCents,knownUnusedCents,amountCents:needsAllocation ? null : knownUnusedCents,needsAllocation,payers,
    formula:{kind,deductionCents:paidCents-knownUnusedCents,regions,packIds:[...ids],rules,
      days:rules.filter(r=>r.id==='FL').flatMap(r=>r.days),rounding:'half-up cents; total once, cumulative payer shares',
      explanation:kind==='cooling-full'?'All allocated receipt-backed payments, including initiation and other fees, are refund due.':'The smallest enabled governing-state deduction applies; every other allocated receipt-backed cent is refund due.'}};
}

import { instant, integer, insist, text } from './types';

export type PayMode = 'flat-class' | 'per-appointment' | 'hourly' | 'per-attendee' | 'tiered';
export interface PayTier { upTo: number | null; rateCents: number }
export interface PayRate { mode: PayMode; rateCents?: number; tiers?: PayTier[]; minimumCents: number }
export interface CancellationPay { treatment: 'none' | 'full' | 'flat'; amountCents?: number }
export const payModes: PayMode[] = ['flat-class','per-appointment','hourly','per-attendee','tiered'];
export const cents = (value: unknown, field = 'amount_cents', signed = false) => integer(value,field,signed ? -Number.MAX_SAFE_INTEGER : 0,Number.MAX_SAFE_INTEGER);
export const exactCents = (value: bigint): number => {
  insist(value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER),'teaching_pay_overflow');
  return Number(value);
};
export const sumCents = (values: number[]) => exactCents(values.reduce((sum,value) => sum+BigInt(cents(value,'amount_cents',true)),0n));
export function payObject(value: unknown, field: string): Record<string,unknown> {
  insist(value !== null && typeof value === 'object' && !Array.isArray(value),`invalid_${field}`);
  return value as Record<string,unknown>;
}
export function payRate(value: unknown): PayRate {
  const input = payObject(value,'pay_rate'), mode = text(input.mode,'pay_mode',30) as PayMode;
  insist(payModes.includes(mode),'invalid_pay_mode');
  const minimumCents = cents(input.minimumCents ?? 0,'minimum_cents');
  if (mode !== 'tiered') {
    insist(input.tiers === undefined,'tiers_require_tiered_mode');
    return {mode,rateCents:cents(input.rateCents,'rate_cents'),minimumCents};
  }
  insist(input.rateCents === undefined,'tiered_rate_uses_tiers');
  insist(Array.isArray(input.tiers) && input.tiers.length > 0 && input.tiers.length <= 100,'invalid_pay_tiers');
  const rawTiers = input.tiers;
  let previous = 0;
  const tiers = rawTiers.map((value,index): PayTier => {
    const tier = payObject(value,'pay_tier');
    const upTo = tier.upTo === null ? null : integer(tier.upTo,'tier_up_to',previous+1,1_000_000);
    insist((upTo === null) === (index === rawTiers.length-1),'last_pay_tier_must_be_unbounded');
    if (upTo !== null) previous = upTo;
    return {upTo,rateCents:cents(tier.rateCents,'tier_rate_cents')};
  });
  return {mode,tiers,minimumCents};
}
export function cancellationPay(value: unknown): CancellationPay {
  const input = payObject(value,'cancellation_pay');
  insist(['none','full','flat'].includes(String(input.treatment)),'invalid_cancellation_treatment');
  const treatment = input.treatment as CancellationPay['treatment'];
  if (treatment === 'flat') return {treatment,amountCents:cents(input.amountCents,'cancellation_cents')};
  insist(input.amountCents === undefined,'cancellation_amount_requires_flat');
  return {treatment};
}
/** Tier bounds are inclusive: [1, upTo], then [previous upTo + 1, upTo].
 * Every attendee is paid at their marginal tier, with an unbounded final tier.
 * Hourly pay uses elapsed milliseconds (fractional minutes retained), with one
 * final half-up rounding to cents, including across daylight-saving changes. */
export function calculatePay(rate: PayRate, start: string, end: string, attendees: number, cancellation?: CancellationPay) {
  rate = payRate(rate);
  if (cancellation) cancellation = cancellationPay(cancellation);
  const startAt = Date.parse(instant(start,'start')), endAt = Date.parse(instant(end,'end'));
  insist(endAt > startAt,'invalid_teaching_duration');
  integer(attendees,'attendees',0,1_000_000);
  insist(rate.mode !== 'per-appointment','appointment_pay_requires_appointment',409);
  const duration = BigInt(endAt)-BigInt(startAt), parts: {from: number; to: number; count: number; rateCents: number; amountCents: number}[] = [];
  let gross = 0n;
  if (rate.mode === 'tiered') {
    let previous = 0;
    for (const tier of rate.tiers!) {
      const top = Math.min(attendees,tier.upTo ?? attendees), count = Math.max(0,top-previous);
      if (count) parts.push({from:previous+1,to:top,count,rateCents:tier.rateCents,amountCents:exactCents(BigInt(count)*BigInt(tier.rateCents))});
      gross += BigInt(count)*BigInt(tier.rateCents);
      if (tier.upTo === null || tier.upTo >= attendees) break;
      previous = tier.upTo;
    }
  } else {
    const amount = BigInt(rate.rateCents!);
    gross = rate.mode === 'hourly' ? (amount*duration+1_800_000n)/3_600_000n
      : rate.mode === 'per-attendee' ? amount*BigInt(attendees) : amount;
  }
  const grossCents = exactCents(gross), minimumAppliedCents = Math.max(0,rate.minimumCents-grossCents);
  const normalCents = sumCents([grossCents,minimumAppliedCents]);
  const baseCents = cancellation?.treatment === 'none' ? 0 : cancellation?.treatment === 'flat' ? cancellation.amountCents! : normalCents;
  return {grossCents,minimumCents:rate.minimumCents,minimumAppliedCents,normalCents,baseCents,elapsedMinutes:Number(duration)/60_000,attendees,tiers:parts,cancellation:cancellation ?? null};
}

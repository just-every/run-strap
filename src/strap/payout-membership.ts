import { DomainError, insist, type RecordData } from './domain/types';
import type { BillingBindings } from './billing/model';
import { balanceTransaction, stripeList } from './billing/provider';

export function sumCents(rows: Record<string,any>[], key: string) {
  return rows.reduce((total,row)=>{
    const value=total+row[key];
    insist(Number.isSafeInteger(value),'payout_total_out_of_range',409);
    return value;
  },0);
}

/** Retain a complete provider statement, never a partially read payout batch. */
export async function payoutMembership(env: BillingBindings,payout: ReturnType<typeof import('./billing/provider').payoutObservation>) {
  try {
    insist(payout.automatic,'payout_membership_unavailable',409);
    insist(payout.providerReconciliationStatus==='completed','payout_membership_not_ready',409);
    const transactions=(await stripeList(env,'/balance_transactions?payout='+encodeURIComponent(payout.providerPayoutId))).map(balanceTransaction);
    insist(transactions.every(t=>t.currency===payout.currency),'payout_membership_currency_mismatch',502);
    // Check arithmetic before retaining any part of the statement.
    for(const key of ['grossCents','feeCents','netCents'])sumCents(transactions,key);
    return {transactions,transactionIds:transactions.map(t=>t.providerTransactionId),mappingError:null};
  } catch(error) {
    return {transactions:null,transactionIds:null,mappingError:error instanceof DomainError?error.code:'payout_provider_read_unavailable'};
  }
}

/** Provider agreement and native source coverage are independent of bank receipt. */
export function membershipReport(payout: RecordData,cards: RecordData[],current: boolean) {
  const transactions: ReturnType<typeof balanceTransaction>[]|null=payout.transactions ?? null;
  const complete=current && !payout.mappingError && transactions!==null;
  const statementTotals=complete?{grossCents:sumCents(transactions,'grossCents'),feeCents:sumCents(transactions,'feeCents'),netCents:sumCents(transactions,'netCents')}:null;
  const matched=cards.filter(card=>card.accountId===payout.accountId && card.currency===payout.currency && transactions?.some(t=>t.providerTransactionId===card.providerTransactionId && t.sourceId===card.providerChargeId && t.type==='charge' && t.grossCents===card.grossCents && t.feeCents===card.feeCents && t.netCents===card.netCents));
  const unmapped=transactions===null?null:transactions.length-matched.length;
  const mappedNetCents=sumCents(matched,'netCents');
  return {
    statementTotals,statementDifferenceCents:statementTotals?payout.amountCents-statementTotals.netCents:null,
    cardObservationIds:matched.map(card=>card.id),mappedNetCents,unmappedTransactionCount:unmapped,
    nativeCoverageStatus:complete && unmapped===0?'complete':'unresolved',
    providerDifferenceCents:complete && unmapped===0?payout.amountCents-mappedNetCents:null,
  };
}

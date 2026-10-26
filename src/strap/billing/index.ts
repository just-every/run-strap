import { load, Transaction } from '../domain/store';
import { DomainError, insist, list, type Actor } from '../domain/types';
import { acceptAgreement, prepareAgreement, revokeMandate } from './agreements';
import { connection, type BillingBindings } from './model';
import { providerCommand } from './operations';
export { agreementEvidence, assembleAgreementEvidence, renderAgreementCopy } from './agreements';
export type { BillingBindings } from './model';

/** HTTP adds the native SEC-004 factor gate to the owner-only commands. */
export async function billingCommand(env: BillingBindings,who: Actor,name: string,input: Record<string,unknown>) {
  insist(['billing.connect','billing.agreement.prepare','billing.agreement.accept','billing.mandate.revoke','billing.setup.start','billing.setup.complete'].includes(name),'unknown_command',404);
  if(['billing.connect','billing.setup.start','billing.setup.complete'].includes(name))return providerCommand(env,who,name,input);
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);
  const result=name === 'billing.agreement.prepare' ? await prepareAgreement(tx,input) : name === 'billing.agreement.accept' ? await acceptAgreement(tx,input) : revokeMandate(tx,input);
  await tx.commit();return result;
}
export async function billingState(env: BillingBindings,who: Actor) {
  const loaded=await load(env.DB,who);
  insist(who.role === 'owner' && who.isOwner || who.role === 'member','billing_access_required',403);
  const visible=(r: Record<string,any>)=>who.role === 'owner' || r.personId === who.personId;
  let c=null;
  try { c=await connection(env); } catch(error) {
    // Only known disconnected states are product outcomes. A broken database,
    // invalid live credential or unexpected validator failure must remain visible.
    if(!(error instanceof DomainError) || !['billing_reconnection_required','stripe_billing_test_not_configured'].includes(error.code))throw error;
  }
  return {mode:'test',configured:!!env.STRIPE_BILLING_TEST_KEY && env.RER_DEMO !== '1',connected:!!c,connection:who.role === 'owner' && c ? {accountId:c.account_id,connectionId:c.connection_id} : null,
    agreements:list(loaded.state,'billingAgreement').filter(visible).map(({adultEvidenceReference,requestBasis,...a})=>a),mandates:list(loaded.state,'paymentMandate').filter(visible),setups:list(loaded.state,'billingSetup').filter(visible),methods:list(loaded.state,'storedPaymentMethod').filter(visible).map(({paymentMethodId,...m})=>({...m,available:!!c && m.connectionId === c.connection_id && loaded.state.records.get(m.mandateId)?.data.status === 'accepted'})),operations:list(loaded.state,'billingOperation').filter(r=>who.role === 'owner' || r.personId === who.personId),collectionImplemented:false};
}

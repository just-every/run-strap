import { hasStaffRight } from '../domain/staff-rights';
import { load, Transaction } from '../domain/store';
import { DomainError, humanOwner, insist, list, now, type Actor } from '../domain/types';
import { acceptAgreement, prepareAgreement, revokeMandate } from './agreements';
import { connection, type BillingBindings } from './model';
import { providerCommand } from './operations';
import { launchBillingAction } from './launch';
import { requestMethodRemoval, removeMethod } from './methods';
import type { MemberDoor } from '../domain/command-catalogue';
import { startCheckout, reconcileCheckout } from './checkout';
import { balance } from '../domain/money';
export { agreementEvidence, assembleAgreementEvidence, renderAgreementCopy } from './agreements';
export type { BillingBindings } from './model';

type BillingRun = (env: BillingBindings,who: Actor,input: Record<string,unknown>)=>Promise<any>;
function defineBilling(run: BillingRun,roles: Actor['role'][],options: {member?: MemberDoor;staffRight?: string} = {}) {
  if(roles.includes('member') && !options.member)throw new Error('Member command requires its staff door');
  return {run,roles,...options};
}
const native = (run: (tx: Transaction,input: Record<string,unknown>)=>any): BillingRun => async(env,who,input)=>{
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);
  const result=await run(tx,input);
  await tx.commit();return result;
};
const hosted = (name: string): BillingRun => (env,who,input)=>providerCommand(env,who,name,input);
const launch = (name: string,right: string)=>defineBilling(native((tx,input)=>launchBillingAction(tx,input,name,right)),right === 'collection' ? ['owner','manager','front-desk','finance'] : ['owner','manager','front-desk'],{staffRight:right});
const member = (name: string,right: string)=>({member:{staff:name+'.launch',right,ownStep:true}});
const handlers = {
  'billing.connect':defineBilling(hosted('billing.connect'),['owner']),
  'billing.disconnect':defineBilling(native((tx,input)=>{
    humanOwner(tx.who);insist(input.confirm===true,'billing_disconnect_confirmation_required');
    const event={id:crypto.randomUUID(),type:'disconnect',actorId:tx.who.id,at:now()};
    tx.sql.push(tx.statement("DELETE FROM st_payment_connections WHERE id='billing'"),tx.statement("DELETE FROM st_payment_control WHERE id='billing'"));
    tx.put('billingConnectionEvent',event);return event;
  }),['owner']),
  'billing.checkout.start':defineBilling(startCheckout,['owner']),
  'billing.reconcile':defineBilling(reconcileCheckout,['owner']),
  'billing.agreement.prepare':defineBilling(native(prepareAgreement),['owner','manager','front-desk'],{staffRight:'membership-sale'}),
  'billing.agreement.accept':defineBilling(native(acceptAgreement),['member'],member('billing.agreement.accept','membership-sale')),
  'billing.agreement.accept.launch':launch('billing.agreement.accept','membership-sale'),
  'billing.mandate.revoke':defineBilling(native(revokeMandate),['member'],member('billing.mandate.revoke','collection')),
  'billing.mandate.revoke.launch':launch('billing.mandate.revoke','collection'),
  'billing.setup.start':defineBilling(hosted('billing.setup.start'),['member'],member('billing.setup.start','collection')),
  'billing.setup.start.launch':launch('billing.setup.start','collection'),
  'billing.setup.complete':defineBilling(hosted('billing.setup.complete'),['member'],member('billing.setup.complete','collection')),
  'billing.setup.complete.launch':launch('billing.setup.complete','collection'),
  'billing.method.removal.request':defineBilling(native(requestMethodRemoval),['member'],member('billing.method.removal.request','collection')),
  'billing.method.removal.request.launch':launch('billing.method.removal.request','collection'),
  'billing.method.remove':defineBilling(native((tx,input)=>removeMethod(tx,input)),['member'],{member:{staff:'billing.method.remove.staff',right:'collection'}}),
  'billing.method.remove.staff':defineBilling(native((tx,input)=>removeMethod(tx,input,true)),['owner','manager','front-desk','finance'],{staffRight:'collection'}),
};
export const delegatedBillingRight = (name: string) => ((Object.hasOwn(handlers, name) ? handlers[name as keyof typeof handlers] : undefined) as {staffRight?: string} | undefined)?.staffRight;
export const billingCommandCatalogue = ()=>Object.entries(handlers).map(([name,spec])=>({name,roles:spec.roles,memberDoor:spec.member ?? null,staffRight:spec.staffRight ?? null}));

/** HTTP adds the native SEC-004 factor gate to the owner-only commands. */
export async function billingCommand(env: BillingBindings,who: Actor,name: string,input: Record<string,unknown>) {
  const handler=Object.hasOwn(handlers, name) ? handlers[name as keyof typeof handlers] : undefined;
  insist(handler,'unknown_command',404);
  return handler.run(env,who,input);
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
  const reviews=list(loaded.state,'billingConnectionReview');
  return {mode:'test',configured:!!env.STRIPE_BILLING_TEST_KEY && env.RER_DEMO !== '1',connected:!!c,connection:who.role === 'owner' && c ? {accountId:c.account_id,connectionId:c.connection_id,review:reviews.filter(r=>r.connectionId===c.connection_id).at(-1)} : null,
    reviews:who.role === 'owner'?reviews:[],connectionEvents:who.role === 'owner'?list(loaded.state,'billingConnectionEvent'):[],
    invoices:list(loaded.state,'stripeInvoice').filter(visible).map(r=>({...r,balanceCents:balance(loaded.state,r.personId),access:loaded.state.records.get(r.packId)?.data.remaining ?? null})),
    events:who.role === 'owner'?list(loaded.state,'stripeEvent'):[],exceptions:who.role === 'owner'?list(loaded.state,'billingException'):[],reconciliations:who.role === 'owner'?list(loaded.state,'billingReconciliation'):[],
    removalRequests:list(loaded.state,'billingMethodRemovalRequest').filter(visible).map(({requestBasis,...r})=>r),removals:list(loaded.state,'billingMethodRemoval').filter(visible).map(({requestBasis,...r})=>r),
    launches:list(loaded.state,'billingActionLaunch').filter(visible).map(({requestBasis,...l})=>l),agreements:list(loaded.state,'billingAgreement').filter(visible).map(({adultEvidenceReference,requestBasis,...a})=>a),mandates:list(loaded.state,'paymentMandate').filter(visible),setups:list(loaded.state,'billingSetup').filter(visible),methods:list(loaded.state,'storedPaymentMethod').filter(visible).map(({paymentMethodId,...m})=>({...m,available:!!c && m.status === 'authorized' && m.connectionId === c.connection_id && loaded.state.records.get(m.mandateId)?.data.status === 'accepted' && loaded.state.records.get(m.mandateId)?.data.methodId === m.id})),operations:list(loaded.state,'billingOperation').filter(r=>who.role === 'owner' || r.personId === who.personId),collectionImplemented:false};
}

/** A scoped staff page reveals action handles, never agreement or payment evidence. */
export async function billingStaffHandoffs(env: BillingBindings,who: Actor) {
  const loaded=await load(env.DB,who);
  return list(loaded.state,'billingAgreement').flatMap(a=>{
    const terms=loaded.state.records.get(a.termsId)?.data,pack=terms && loaded.state.records.get(terms.currentPackId)?.data;
    if(!pack)return [];
    const permitted=(right: 'collection'|'membership-sale')=>hasStaffRight(loaded.state,loaded.who,right,a.personId,pack.locationId ?? 'studio');
    const mandate=list(loaded.state,'paymentMandate').find(m=>m.agreementId===a.id);
    const actions=terms?.status !== 'active' ? (permitted('collection') ? ['billing.method.removal.request'] : []) : !a.signature && permitted('membership-sale') ? ['billing.agreement.accept'] : mandate?.status==='accepted' && permitted('collection') ? ['billing.setup.start','billing.setup.complete','billing.mandate.revoke','billing.method.removal.request'] : [];
    const removalRequests=permitted('collection') ? list(loaded.state,'billingMethodRemovalRequest').filter(r=>r.agreementId===a.id && r.status==='requested' && loaded.state.records.get(r.methodId)?.data.removalRequestId===r.id).map(r=>({id:r.id,methodId:r.methodId,brand:r.brand,last4:r.last4,requestedAt:r.requestedAt})) : [];
    const removals=permitted('collection') ? list(loaded.state,'billingMethodRemoval').filter(r=>r.agreementId===a.id && r.actorId===loaded.who.id).flatMap(r=>{const method=loaded.state.records.get(r.methodId)?.data;return method?.status==='removed' && !method.erased ? [{id:r.id,methodId:method.id,brand:method.brand,last4:method.last4,at:r.at}] : [];}) : [];
    return actions.length || removalRequests.length || removals.length ? [{id:a.id,personId:a.personId,actions,removalRequests,removals}] : [];
  });
}

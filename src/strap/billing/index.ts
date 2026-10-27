import { load, Transaction } from '../domain/store';
import { DomainError, insist, list, type Actor } from '../domain/types';
import { acceptAgreement, prepareAgreement, revokeMandate } from './agreements';
import { connection, type BillingBindings } from './model';
import { providerCommand } from './operations';
import { launchBillingAction } from './launch';
import type { MemberDoor } from '../domain/command-catalogue';
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
const launch = (name: string,right: string)=>defineBilling(native((tx,input)=>launchBillingAction(tx,input,name,right)),right === 'collection' ? ['owner','manager','front-desk','finance'] : ['owner'],{staffRight:right});
const member = (name: string,right: string)=>({member:{staff:name+'.launch',right,ownStep:true}});
const handlers = {
  'billing.connect':defineBilling(hosted('billing.connect'),['owner']),
  'billing.agreement.prepare':defineBilling(native(prepareAgreement),['owner'],{staffRight:'membership-sale'}),
  'billing.agreement.accept':defineBilling(native(acceptAgreement),['member'],member('billing.agreement.accept','membership-sale')),
  'billing.agreement.accept.launch':launch('billing.agreement.accept','membership-sale'),
  'billing.mandate.revoke':defineBilling(native(revokeMandate),['member'],member('billing.mandate.revoke','collection')),
  'billing.mandate.revoke.launch':launch('billing.mandate.revoke','collection'),
  'billing.setup.start':defineBilling(hosted('billing.setup.start'),['member'],member('billing.setup.start','collection')),
  'billing.setup.start.launch':launch('billing.setup.start','collection'),
  'billing.setup.complete':defineBilling(hosted('billing.setup.complete'),['member'],member('billing.setup.complete','collection')),
  'billing.setup.complete.launch':launch('billing.setup.complete','collection'),
};
export const billingCommandCatalogue = ()=>Object.entries(handlers).map(([name,spec])=>({name,roles:spec.roles,memberDoor:spec.member ?? null,staffRight:spec.staffRight ?? null}));

/** HTTP adds the native SEC-004 factor gate to the owner-only commands. */
export async function billingCommand(env: BillingBindings,who: Actor,name: string,input: Record<string,unknown>) {
  const handler=handlers[name as keyof typeof handlers];
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
  return {mode:'test',configured:!!env.STRIPE_BILLING_TEST_KEY && env.RER_DEMO !== '1',connected:!!c,connection:who.role === 'owner' && c ? {accountId:c.account_id,connectionId:c.connection_id} : null,
    launches:list(loaded.state,'billingActionLaunch').filter(visible).map(({requestBasis,...l})=>l),agreements:list(loaded.state,'billingAgreement').filter(visible).map(({adultEvidenceReference,requestBasis,...a})=>a),mandates:list(loaded.state,'paymentMandate').filter(visible),setups:list(loaded.state,'billingSetup').filter(visible),methods:list(loaded.state,'storedPaymentMethod').filter(visible).map(({paymentMethodId,...m})=>({...m,available:!!c && m.connectionId === c.connection_id && loaded.state.records.get(m.mandateId)?.data.status === 'accepted' && loaded.state.records.get(m.mandateId)?.data.methodId === m.id})),operations:list(loaded.state,'billingOperation').filter(r=>who.role === 'owner' || r.personId === who.personId),collectionImplemented:false};
}

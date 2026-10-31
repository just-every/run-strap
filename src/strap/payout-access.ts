import type { Bindings } from '../auth.server';
import { load, Transaction } from './domain/store';
import { DomainError, humanOwner, insist, list, now, person, text, type Actor, type State } from './domain/types';
import { cleared } from './security/gate';
import { connection, digest, fenceConnection, reviewedConnection, type BillingBindings, type Connection } from './billing/model';

/** Payout reads disclose the whole merchant statement, independently of scoped collection rights. */
async function financeBasis(env: BillingBindings,state: State,personId: string): Promise<string|null> {
  const member=state.people.find(p=>p.id===personId && p.active && !p.erasedAt && p.role==='member' && p.email);
  if(!member)return null;
  const access=state.records.get('staff-access:'+personId);
  if(access)return access.kind==='staffAccess' && access.data.enabled && access.data.role==='finance' ? 'staff:'+access.data.version : null;
  const legacy=await env.DB.prepare("SELECT a.id FROM st_finance_users f JOIN st_security_audit a ON a.subject_id=f.person_id AND a.action='finance.grant' WHERE f.person_id=? ORDER BY a.rowid DESC LIMIT 1").bind(personId).first<{id:string}>();
  return legacy ? 'finance:'+legacy.id : null;
}
export async function payoutAuthority(env: BillingBindings,who: Actor,ownerOnly=true) {
  const loaded=await load(env.DB,who);
  if(ownerOnly)humanOwner(loaded.who);
  else insist(loaded.who.role==='owner' && loaded.who.isOwner || loaded.who.role==='finance','payout_read_right_required',403);
  insist(await cleared(env as Bindings,loaded.who),'mfa_required',403);
  insist(who.sessionId && await env.DB.prepare('SELECT id FROM oa_sessions WHERE id=? AND operator_id=? AND operator_version=? AND revoked_at IS NULL AND expires_at>?').bind(who.sessionId,who.id,loaded.state.operator.version,Date.now()).first(),loaded.who.role==='owner'?'owner_session_required':'payout_session_required',401);
  if(loaded.who.role==='finance')insist(await payoutAccessAvailable(env,loaded.state,loaded.who),'payout_read_right_required',403);
  return loaded;
}
export function fencePayoutAuthority(tx: Transaction) {
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_sessions s JOIN st_mfa_sessions m ON m.session_id=s.id AND m.operator_id=s.operator_id WHERE s.id=? AND s.operator_id=? AND s.operator_version=? AND s.revoked_at IS NULL AND s.expires_at>unixepoch('now')*1000) THEN 1 ELSE 0 END",tx.who.sessionId,tx.who.id,tx.state.operator.version));
}
async function validGrant(env: BillingBindings,state: State,personId: string,c: Connection) {
  const grant=state.records.get('payout-access:'+personId);
  return !!grant && grant.kind==='payoutAccess' && grant.data.enabled===true && grant.data.accountId===c.account_id
    && grant.data.connectionId===c.connection_id && grant.data.financeBasis===await financeBasis(env,state,personId);
}
export async function payoutAccessAvailable(env: BillingBindings,state: State,who: Actor) {
  if(who.role!=='finance' || !who.personId)return false;
  try {const c=await connection(env);reviewedConnection(state,c);return await validGrant(env,state,who.personId,c);}
  catch(error) {
    if(error instanceof DomainError && ['billing_reconnection_required','stripe_billing_test_not_configured','billing_connection_review_required'].includes(error.code))return false;
    throw error;
  }
}
export async function payoutAccessSettings(env: BillingBindings,state: State) {
  const candidates=[];
  for(const member of state.people) {
    const basis=await financeBasis(env,state,member.id);
    if(basis)candidates.push({personId:member.id,financeBasis:basis});
  }
  return {candidates,grants:list(state,'payoutAccess'),history:list(state,'payoutAccessEvent')};
}
/** Exact owner approval grants retained reads only; captured approvals cannot revive a revoked grant. */
export async function changePayoutAccess(env: BillingBindings,who: Actor,input: Record<string,unknown>,enabled: boolean) {
  const loaded=await payoutAuthority(env,who),tx=new Transaction(env.DB,loaded.state,loaded.who);
  const target=person(tx.state,input.personId,false),requestId=text(input.requestId,'requestId',100);
  insist(input.confirm===true,'payout_access_confirmation_required');
  const reason=text(input.reason,'reason',500),key=await digest({input,enabled});
  const eventId='payout-access-event:'+await digest({actorId:who.id,requestId});
  const prior=tx.state.records.get(eventId);
  if(prior) {insist(prior.kind==='payoutAccessEvent' && prior.data.key===key,'payout_access_request_changed',409);return prior.data;}
  const before=tx.state.records.get('payout-access:'+target.id)?.data;
  insist(Number.isSafeInteger(input.version) && input.version===(before?.version??0),'payout_access_changed',409);
  const basis=await financeBasis(env,tx.state,target.id);
  let c: Connection|null=null;
  if(enabled) {
    insist(basis && input.financeBasis===basis,'payout_finance_authority_changed',409);
    c=await connection(env);reviewedConnection(tx.state,c);
    insist(input.accountId===c.account_id && input.connectionId===c.connection_id,'billing_connection_changed',409);
    fenceConnection(tx,c);
    // Legacy finance grants live outside st_meta; fence their exact reviewed identity too.
    if(basis.startsWith('finance:'))tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_finance_users WHERE person_id=? AND (SELECT id FROM st_security_audit WHERE subject_id=? AND action='finance.grant' ORDER BY rowid DESC LIMIT 1)=?) THEN 1 ELSE 0 END",target.id,target.id,basis.slice(8)));
  }
  fencePayoutAuthority(tx);
  const grant={id:'payout-access:'+target.id,personId:target.id,enabled,version:(before?.version??0)+1,financeBasis:basis,
    accountId:c?.account_id??before?.accountId??null,connectionId:c?.connection_id??before?.connectionId??null,updatedAt:now(),updatedBy:who.id,reason};
  const event={id:eventId,key,personId:target.id,actorId:who.id,actorRole:who.role,at:grant.updatedAt,reason,before:before??null,after:grant};
  tx.put('payoutAccess',grant);tx.put('payoutAccessEvent',event);await tx.commit();return event;
}

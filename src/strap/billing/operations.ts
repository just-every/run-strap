import { load, Transaction } from '../domain/store';
import { DomainError, humanOwner, id, insist, list, now, text, type Actor, type RecordData } from '../domain/types';
import { connection, digest, keyDigest, requireMandate, type BillingBindings, type Connection } from './model';
import { hostedURL, ProviderFailure, savedMethod, session, stripe } from './provider';

const fence=(tx: Transaction,c: Connection)=>tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_payment_connections WHERE id='billing' AND connection_id=? AND origin=? AND account_id=? AND key_digest=?) THEN 1 ELSE 0 END",c.connection_id,c.origin,c.account_id,c.key_digest));
const retained=(state: Transaction['state'],operation: RecordData)=>({...operation,result:operation.resultId ? state.records.get(operation.resultId)?.data ?? null : null});

/** No paid-edge operation begins before its exact native reservation commits. */
export async function providerCommand(env: BillingBindings,who: Actor,name: string,input: Record<string,unknown>) {
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);
  const requestId=text(input.requestId,'requestId',100), inputHash=await digest(input), operationId='billing-operation:'+await digest({actorId:who.id,name,requestId});
  const localKey=await keyDigest(env), prior=tx.state.records.get(operationId)?.data;
  let c: Connection|null=null, agreement: RecordData|null=null, mandate: RecordData|null=null, setup: RecordData|null=null;
  if(name === 'billing.connect') {
    humanOwner(tx.who); insist(input.mode === 'test' && input.confirm === true,'billing_test_connection_confirmation_required');
    text(input.accountId,'accountId',100);
  } else {
    c=await connection(env);
    ({agreement,mandate}=requireMandate(tx.state,input.id,tx.who));
    if(name === 'billing.setup.complete') {
      setup=tx.state.records.get(text(input.setupId,'setupId',100))?.data ?? null;
      insist(setup?.agreementId === agreement.id && setup.connectionId === c.connection_id && setup.personId === who.personId,'billing_setup_not_found',404);
    }
  }
  if(prior) {
    insist(prior.inputHash === inputHash && prior.origin === env.AUTH_ORIGIN && prior.connectionId === (c?.connection_id ?? prior.connectionId),'billing_request_changed',409);
    // A durable replay never repeats a provider write or manufactures a hosted URL.
    return retained(tx.state,prior);
  }
  if(name === 'billing.setup.start') {
    insist(!mandate!.methodAuthorized,'billing_method_already_authorized',409);
    insist(!list(tx.state,'billingOperation').some(o=>o.type === 'setup.start' && o.agreementId === agreement!.id && ['pending','uncertain','succeeded'].includes(o.status)),'billing_setup_already_started',409);
  }
  const reservation={id:operationId,type:name.slice(8),personId:agreement?.personId ?? null,agreementId:agreement?.id ?? null,mandateId:mandate?.id ?? null,setupId:setup?.id ?? null,requestId,inputHash,origin:env.AUTH_ORIGIN,connectionId:c?.connection_id ?? id(),actorId:who.id,actorRole:who.role,createdAt:now(),status:'pending',mode:'test',resultId:null};
  if(c)fence(tx,c);
  tx.put('billingOperation',reservation); await tx.commit();
  let receipt: {requestId:string|null;httpStatus:number}|null=null,result: RecordData|null=null,errorCode:string|null=null,status='uncertain',launchURL:string|null=null;
  try {
    let body: Record<string,any>;
    if(name === 'billing.connect') {
      const r=await stripe(env,'/account');receipt={requestId:r.requestId,httpStatus:r.httpStatus};body=r.body;
      insist(body.object === 'account' && body.id === input.accountId,'billing_account_mismatch',409);
    } else if(name === 'billing.setup.start') {
      const form=new URLSearchParams({mode:'setup',currency:'usd','payment_method_types[0]':'card',client_reference_id:agreement!.id,success_url:env.AUTH_ORIGIN+'/app/packs?billing=returned',cancel_url:env.AUTH_ORIGIN+'/app/packs?billing=canceled'});
      for(const [k,v] of Object.entries({agreementId:agreement!.id,mandateId:mandate!.id,operationId})) { form.set('metadata['+k+']',v);form.set('setup_intent_data[metadata]['+k+']',v); }
      const r=await stripe(env,'/checkout/sessions',form,operationId);receipt={requestId:r.requestId,httpStatus:r.httpStatus};body=r.body;
      session(body,agreement!.id,mandate!.id,operationId); launchURL=hostedURL(body.url);
    } else {
      const r=await stripe(env,'/checkout/sessions/'+encodeURIComponent(setup!.providerSessionId)+'?expand[]=setup_intent.payment_method');receipt={requestId:r.requestId,httpStatus:r.httpStatus};body=r.body;
      savedMethod(body,agreement!.id,mandate!.id,setup!.operationId);
    }
    // Reload the native actor and mandate after the network edge: an old launch
    // cannot survive member removal, consent revocation or owner disconnection.
    const fresh=await load(env.DB,who),finish=new Transaction(env.DB,fresh.state,fresh.who);
    insist(finish.state.records.get(operationId)?.data.status === 'pending','billing_operation_changed',409);
    if(name === 'billing.connect') {
      humanOwner(finish.who); insist(await keyDigest(env) === localKey,'billing_connection_changed',409);
      finish.sql.push(finish.statement("INSERT INTO st_payment_connections(id,connection_id,origin,account_id,key_digest,approved_by,approved_at) VALUES('billing',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id,origin=excluded.origin,account_id=excluded.account_id,key_digest=excluded.key_digest,approved_by=excluded.approved_by,approved_at=excluded.approved_at",reservation.connectionId,env.AUTH_ORIGIN,body.id,localKey,who.id,now()));
      result={id:'billing-connection-review:'+reservation.connectionId,accountId:body.id,mode:'test',connectionId:reservation.connectionId,approvedAt:now(),approvedBy:who.id};finish.put('billingConnectionReview',result);
    } else {
      const current=await connection(env); insist(current.connection_id === c!.connection_id,'billing_connection_changed',409); fence(finish,current);
      const accepted=requireMandate(finish.state,agreement!.id,finish.who);
      insist(accepted.mandate.financialHash === mandate!.financialHash,'billing_mandate_changed',409);
      if(name === 'billing.setup.start') {
        const checked=session(body,agreement!.id,mandate!.id,operationId);
        result={id:'billing-setup:'+operationId,personId:agreement!.personId,agreementId:agreement!.id,mandateId:mandate!.id,operationId,connectionId:c!.connection_id,accountId:c!.account_id,providerSessionId:checked.id,status:'awaiting-member',expiresAt:checked.expiresAt,createdAt:now()};finish.put('billingSetup',result);
      } else {
        const method=savedMethod(body,agreement!.id,mandate!.id,setup!.operationId);
        const existing=list(finish.state,'storedPaymentMethod').find(m=>m.setupId === setup!.id);
        if(existing)result=existing;
        else {
          result={id:'billing-method:'+setup!.id,personId:agreement!.personId,agreementId:agreement!.id,mandateId:mandate!.id,setupId:setup!.id,connectionId:c!.connection_id,accountId:c!.account_id,...method,authorizedBy:who.id,authorizedAt:now(),authorizationChannel:'member-account-and-stripe-hosted-setup',status:'authorized'};
          finish.put('storedPaymentMethod',result);
          finish.put('paymentMandate',{...accepted.mandate,methodAuthorized:true,methodId:result.id,methodAuthorizedAt:result.authorizedAt,connectionId:c!.connection_id});
          finish.put('billingAgreement',{...accepted.agreement,status:'signed-method-authorized'});
          finish.put('billingSetup',{...setup!,status:'completed',completedAt:result.authorizedAt,methodId:result.id});
          finish.put('billingConsentEvent',{id:'billing-method-consent:'+setup!.id,personId:agreement!.personId,agreementId:agreement!.id,mandateId:mandate!.id,actorId:who.id,actorRole:'member',channel:'member-account-and-stripe-hosted-setup',at:result.authorizedAt,before:{methodAuthorized:false},after:{methodAuthorized:true,methodId:result.id,setupIntentId:result.setupIntentId},staffMade:false});
        }
      }
    }
    const completed={...reservation,status:'succeeded',resultId:result!.id,providerReceipt:receipt,finishedAt:now(),errorCode:null};
    finish.put('billingOperation',completed);await finish.commit();
    return {...retained(finish.state,completed),...(launchURL?{launchURL}:{})};
  } catch(error) {
    if(error instanceof ProviderFailure) { receipt={httpStatus:error.status,requestId:error.requestId};errorCode='billing_provider_refused';if([400,401,402,403,404,422].includes(error.status))status='failed'; }
    else errorCode=error instanceof DomainError?error.code:'billing_provider_outcome_unknown';
    if(name === 'billing.setup.complete' && errorCode === 'billing_hosted_setup_incomplete')status='incomplete';
    // Retain only bounded outcome metadata. Never replay a POST automatically.
    const fresh=await load(env.DB,who),finish=new Transaction(env.DB,fresh.state,fresh.who);
    const saved={...reservation,status,errorCode,providerReceipt:receipt,finishedAt:now()};finish.put('billingOperation',saved);await finish.commit();return retained(finish.state,saved);
  }
}

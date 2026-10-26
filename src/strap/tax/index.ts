import { load, Transaction } from '../domain/store';
import { DomainError, humanOwner, insist, list, now, text, type Actor, type RecordData } from '../domain/types';
import { connected, fingerprint, identity, object, retainedResult, type Json, type TaxBindings } from './model';
import { calculationRequest, confirmationRequest, saveCalculation, saveInvoice } from './calculations';
import { parseConfig, readiness, saveConfig } from './config';
import { complete, stripe } from './provider';
import { reversalRequest, saveReversal } from './reversals';
import { taxSnapshot } from './reports';
export { taxSnapshot, taxEvidence, taxFilingCsv } from './reports';
export type { TaxBindings } from './model';

/** Native human owner authority is reloaded independently at every entry.
 * The HTTP layer adds SEC-004 MFA. No agent, member or implicit staff authority. */
export async function taxCommand(env: TaxBindings, who: Actor, name: string, raw: Record<string,unknown>) {
  humanOwner(who);
  const input = object(raw,'tax_input');
  insist(['tax.config.save','tax.calculate','tax.confirm','tax.refund'].includes(name),'unknown_command',404);
  const loaded = await load(env.DB,who); humanOwner(loaded.who);
  const tx = new Transaction(env.DB,loaded.state,loaded.who);
  const connectionHash = await identity(env), requestId = text(input.requestId,'requestId',100);
  const inputFingerprint = await fingerprint(input), operationId = 'tax-operation:' + await fingerprint({actorId:who.id,name,requestId});
  const prior = tx.state.records.get(operationId)?.data;
  if (prior) {
    insist(prior.inputFingerprint === inputFingerprint && prior.connectionHash === connectionHash,'tax_request_changed',409);
    return retainedResult(tx.state,prior);
  }
  const type = name.slice(4).replace('config.save','config');
  const config = name === 'tax.config.save' ? null : await connected(env,tx.state);
  let facts: Json, form: URLSearchParams | null = null, targetId: string, invoiceId: string | null = null;
  if (name === 'tax.config.save') {
    insist(!list(tx.state,'taxOperation').some(o=>o.type === 'config' && ['pending','uncertain'].includes(o.status)),'tax_configuration_pending',409);
    facts = parseConfig(tx,input,connectionHash); targetId = facts.id;
  } else {
    const request = name === 'tax.calculate' ? await calculationRequest(tx,config!,input)
      : name === 'tax.confirm' ? await confirmationRequest(tx,config!,input)
      : await reversalRequest(tx,input);
    ({facts,form,targetId} = request);
    if ('invoiceId' in request) invoiceId = request.invoiceId;
    if (name === 'tax.refund') insist(facts.invoice.connectionHash === connectionHash,'tax_invoice_connection_changed',409);
    if (name === 'tax.confirm' || name === 'tax.refund') {
      insist(!list(tx.state,'taxOperation').some(o=>o.reference === facts.reference),'tax_reference_used',409);
      if (name === 'tax.refund') {
        insist(!list(tx.state,'taxOperation').some(o=>o.type === 'refund' && o.targetId === targetId && ['pending','uncertain','succeeded'].includes(o.status)),'tax_refund_source_used',409);
      }
    }
  }
  const path = name === 'tax.calculate' ? '/tax/calculations' : name === 'tax.confirm' ? '/tax/transactions/create_from_calculation' : '/tax/transactions/create_reversal';
  const reservation: RecordData = {id:operationId,type,requestId,inputFingerprint,connectionHash,targetId,invoiceId,reference:facts.reference ?? null,mode:'test',actorId:who.id,actorRole:'owner',createdAt:now(),status:'pending',errorCode:null,resultId:null,
    approvedInput:input,providerRequest:form ? {method:'POST',path,form:Object.fromEntries(form)} : {method:'GET',paths:['/tax/settings','/tax/registrations?status=active&limit=100']}};
  if (config) tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_tax_connections WHERE id='tax' AND connection_hash=?) THEN 1 ELSE 0 END",connectionHash));
  tx.put('taxOperation',reservation); await tx.commit();
  return complete(env,reservation,()=>form ? stripe(env,path,form,operationId) : readiness(env,facts.registeredStates),
    (finish,body)=>name === 'tax.config.save' ? saveConfig(finish,facts,body)
      : name === 'tax.calculate' ? saveCalculation(finish,reservation,facts,body)
      : name === 'tax.confirm' ? saveInvoice(finish,reservation,facts,body)
      : saveReversal(finish,reservation,facts,body));
}
export async function taxState(env: TaxBindings, who: Actor) {
  humanOwner(who);
  const loaded = await load(env.DB,who); humanOwner(loaded.who);
  let isConnected = false;
  if (env.STRIPE_TAX_TEST_KEY && env.RER_DEMO !== '1') {
    try { await connected(env,loaded.state); isConnected = true; } catch (error) {
      if (!(error instanceof DomainError) || !['taxConfig_not_found','tax_connection_review_required','stripe_tax_test_not_configured'].includes(error.code)) throw error;
    }
  }
  return {...taxSnapshot(loaded.state),configured:!!env.STRIPE_TAX_TEST_KEY && env.RER_DEMO !== '1',connected:isConnected};
}

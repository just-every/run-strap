import { integer, insist, list, now, person, record, text } from '../domain/types';
import type { Transaction } from '../domain/store';
import { address, configId, object, only, states, type Json, type TaxBindings } from './model';
import { accepted, stripe, type Receipt } from './provider';

export function parseConfig(tx: Transaction, input: Json, connectionHash: string) {
  only(input,['requestId','consent','originAddress','registeredStates','products','exemptions']);
  insist(input.consent === true,'tax_configuration_consent_required');
  const originAddress = address(input.originAddress);
  insist(Array.isArray(input.registeredStates) && input.registeredStates.length > 0 && input.registeredStates.length <= 51 && input.registeredStates.every((s: unknown)=>typeof s === 'string' && states.has(s)),'invalid_tax_registered_states');
  const registeredStates = [...new Set(input.registeredStates as string[])];
  insist(Array.isArray(input.products) && input.products.length > 0 && input.products.length <= 500,'tax_products_required');
  const products = input.products.map((value: unknown)=>{
    const p = object(value,'tax_product'); only(p,['id','label','kind','sourceId','taxCode']);
    insist(['retail','service'].includes(p.kind),'invalid_tax_product_kind');
    const source = record(tx.state,p.sourceId,p.kind === 'retail' ? 'sku' : 'pack');
    const taxCode = text(p.taxCode,'tax_code',30);
    insist(/^txcd_\d{8}$/.test(taxCode),'explicit_tax_code_required');
    return {id:text(p.id,'product_id',100),label:text(p.label,'product_label',160),kind:p.kind,sourceId:source.id,taxCode};
  });
  insist(new Set(products.map((p: Json)=>p.id)).size === products.length,'duplicate_tax_product');
  insist(Array.isArray(input.exemptions) && input.exemptions.length <= 500,'invalid_tax_exemptions');
  const exemptions = input.exemptions.map((value: unknown)=>{
    const e = object(value,'tax_exemption'); only(e,['id','personId','reference','reason']);
    const member = person(tx.state,e.personId);
    return {id:text(e.id,'exemption_id',100),personId:member.id,reference:text(e.reference,'exemption_reference',160),reason:text(e.reason,'exemption_reason',1000)};
  });
  insist(new Set(exemptions.map((e: Json)=>e.id)).size === exemptions.length,'duplicate_tax_exemption');
  return {id:configId,mode:'test',currency:'usd',taxBehavior:'exclusive',connectionHash,originAddress,registeredStates,products,exemptions,consent:true,updatedAt:now(),updatedBy:tx.who.id};
}
export async function readiness(env: TaxBindings, selected: string[]): Promise<Receipt> {
  const settings = await stripe(env,'/tax/settings');
  const s = accepted(settings);
  insist(s.object === 'tax.settings' && s.livemode === false && s.status === 'active','tax_test_settings_not_active',409);
  const registrations = await stripe(env,'/tax/registrations?status=active&limit=100');
  const r = accepted(registrations);
  insist(r.object === 'list' && r.has_more === false && Array.isArray(r.data),'tax_registration_evidence_incomplete',409);
  insist(selected.every(state=>r.data.some((reg: Json)=>reg.object === 'tax.registration' && reg.livemode === false && reg.country === 'US' && reg.status === 'active' && reg.country_options?.us?.state === state)),'tax_active_registration_required',409);
  return {httpStatus:200,requestId:settings.requestId,body:{settings,registrations,mode:'test'}};
}
export function saveConfig(tx: Transaction, draft: Json, body: Json) {
  const before = tx.state.records.get(configId)?.data ?? null;
  const saved = {...draft,id:configId,providerReadiness:body};
  tx.sql.push(tx.statement("INSERT INTO st_tax_connections(id,connection_hash,connected_by,connected_at) VALUES('tax',?,?,?) ON CONFLICT(id) DO UPDATE SET connection_hash=excluded.connection_hash,connected_by=excluded.connected_by,connected_at=excluded.connected_at",draft.connectionHash,draft.updatedBy,draft.updatedAt));
  tx.put('taxConfig',saved);
  tx.put('taxConfigEvent',{id:crypto.randomUUID(),before,after:saved,actorId:draft.updatedBy,createdAt:now(),mode:'test'});
  return saved;
}

import { id, integer, insist, list, now, person, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { placeId, locations } from './locations';
import { retailRequest } from './retail-records';
import { postDrawerTender } from './drawer';

export const onHand=(s: State,skuId: string,locationId: string): number => list(s,'stockMovement').filter(m=>m.skuId===skuId && m.locationId===locationId).reduce((n,m)=>n+m.quantity,0);
function movement(tx: Transaction,skuId: string,locationId: string,quantity: number,kind: string,sourceId: string,reason: string) {
  const before=onHand(tx.state,skuId,locationId),after=before+quantity;
  insist(Number.isSafeInteger(after) && after>=0,'insufficient_stock',409);
  const saved={id:id(),skuId,locationId,quantity,before,after,kind,sourceId,reason,actorId:tx.who.id,createdAt:now()};
  tx.put('stockMovement',saved);return saved;
}
export function saveSupplier(tx: Transaction,input: Record<string,unknown>) {
  return retailRequest(tx,'supplier',input,()=>{const saved={id:id(),name:text(input.name,'supplier_name',160),reference:text(input.reference,'supplier_reference',160),createdAt:now(),actorId:tx.who.id};tx.put('supplier',saved);return saved;});
}
export function saveSku(tx: Transaction,input: Record<string,unknown>) {
  return retailRequest(tx,'sku',input,()=>{
    const sku=text(input.sku,'sku',80),barcode=text(input.barcode,'barcode',100),supplier=record(tx.state,input.supplierId,'supplier');
    insist(!list(tx.state,'sku').some(s=>s.sku.toLowerCase()===sku.toLowerCase() || s.barcode===barcode),'sku_or_barcode_used',409);
    const saved={id:id(),sku,barcode,name:text(input.name,'product_name',160),variant:text(input.variant,'variant',80),supplierId:supplier.id,priceCents:integer(input.priceCents,'price_cents',1,100_000_000),lowStock:integer(input.lowStock,'low_stock',0,1_000_000),createdAt:now(),actorId:tx.who.id};
    tx.put('sku',saved);return saved;
  });
}
export function receiveStock(tx: Transaction,input: Record<string,unknown>) {
  return retailRequest(tx,'receive',input,()=>{
    const sku=record(tx.state,input.skuId,'sku'),locationId=placeId(tx.state,input.locationId),quantity=integer(input.quantity,'quantity'),reference=text(input.reference,'purchase_reference',160);
    insist(!list(tx.state,'stockReceipt').some(r=>r.supplierId===sku.supplierId && r.reference===reference && r.skuId===sku.id && r.locationId===locationId),'receipt_reference_used',409);
    const saved={id:id(),skuId:sku.id,supplierId:sku.supplierId,locationId,quantity,reference,createdAt:now(),actorId:tx.who.id};
    tx.put('stockReceipt',saved);movement(tx,sku.id,locationId,quantity,'receive',saved.id,reference);return saved;
  });
}
export function countStock(tx: Transaction,input: Record<string,unknown>) {
  return retailRequest(tx,'count',input,()=>{const sku=record(tx.state,input.skuId,'sku'),locationId=placeId(tx.state,input.locationId),count=integer(input.count,'count',0),reason=text(input.reason,'count_reason',500);return movement(tx,sku.id,locationId,count-onHand(tx.state,sku.id,locationId),'count',id(),reason);});
}
export function transferStock(tx: Transaction,input: Record<string,unknown>) {
  return retailRequest(tx,'transfer',input,()=>{
    const sku=record(tx.state,input.skuId,'sku'),from=placeId(tx.state,input.locationId),to=placeId(tx.state,input.toLocationId),quantity=integer(input.quantity,'quantity'),reason=text(input.reason,'transfer_reason',500);
    insist(from!==to,'different_location_required');const sourceId=id();
    const out=movement(tx,sku.id,from,-quantity,'transfer',sourceId,reason),into=movement(tx,sku.id,to,quantity,'transfer',sourceId,reason);
    return {id:sourceId,movements:[out,into]};
  });
}
export function sellRetail(tx: Transaction,input: Record<string,unknown>) {
  return retailRequest(tx,'sale',input,()=>{
    const sku=input.skuId ? record(tx.state,input.skuId,'sku') : list(tx.state,'sku').find(s=>s.barcode===text(input.barcode,'barcode',100));
    insist(sku,'sku_not_found',404);
    const member=person(tx.state,input.personId),locationId=placeId(tx.state,input.locationId),quantity=integer(input.quantity,'quantity',1,10000),amountCents=integer(sku.priceCents*quantity,'sale_total',1,100_000_000),tender=text(input.tender,'tender',20),reference=text(input.reference,'tender_reference',160);
    insist(['cash','external'].includes(tender),'external_or_cash_only');
    insist(input.expectedCents===amountCents,'sale_price_changed',409);
    insist(!list(tx.state,'payment').some(p=>p.reference===reference),'payment_reference_used',409);
    const saved={id:id(),skuId:sku.id,sku:sku.sku,name:sku.name,variant:sku.variant,personId:member.id,locationId,quantity,unitCents:sku.priceCents,amountCents,tender,reference,chargeId:id(),paymentId:id(),createdAt:now(),actorId:tx.who.id};
    movement(tx,sku.id,locationId,-quantity,'sale',saved.id,reference);
    const drawer=postDrawerTender(tx,input.sessionId,locationId,tender,amountCents,saved.id,'sale');
    const result={...saved,sessionId:drawer?.sessionId ?? null};tx.put('retailSale',result);
    tx.put('charge',{id:saved.chargeId,personId:member.id,locationId,retailSaleId:saved.id,amountCents,reason:'retail_sale',createdAt:saved.createdAt});
    tx.put('payment',{id:saved.paymentId,personId:member.id,locationId,retailSaleId:saved.id,chargeId:saved.chargeId,amountCents,reference,tender,recordedBy:tx.who.id,createdAt:saved.createdAt});return result;
  });
}
export function returnRetail(tx: Transaction,input: Record<string,unknown>) {
  return retailRequest(tx,'return',input,()=>{
    const sale=record(tx.state,input.saleId,'retailSale'),quantity=integer(input.quantity,'quantity',1,sale.quantity),reason=text(input.reason,'return_reason',500);
    insist(typeof input.restock==='boolean','choose_restock_treatment');
    insist(quantity+list(tx.state,'retailReturn').filter(r=>r.saleId===sale.id).reduce((n,r)=>n+r.quantity,0)<=sale.quantity,'quantity_already_returned',409);
    const amountCents=quantity*sale.unitCents,saved={id:id(),saleId:sale.id,skuId:sale.skuId,locationId:sale.locationId,personId:sale.personId,quantity,restock:input.restock,reason,amountCents,tender:sale.tender,chargeId:id(),paymentId:id(),createdAt:now(),actorId:tx.who.id};
    movement(tx,sale.skuId,sale.locationId,input.restock?quantity:0,input.restock?'return':'damaged_return',saved.id,reason);
    const drawer=postDrawerTender(tx,input.sessionId,sale.locationId,sale.tender,-amountCents,saved.id,'refund');
    const result={...saved,sessionId:drawer?.sessionId ?? null};tx.put('retailReturn',result);
    tx.put('charge',{id:saved.chargeId,personId:sale.personId,locationId:sale.locationId,retailReturnId:saved.id,reversesChargeId:sale.chargeId,amountCents:-amountCents,reason:'retail_return',createdAt:saved.createdAt});
    tx.put('payment',{id:saved.paymentId,personId:sale.personId,locationId:sale.locationId,retailReturnId:saved.id,chargeId:saved.chargeId,amountCents:-amountCents,reference:'retail-return-'+saved.id,tender:sale.tender,recordedBy:tx.who.id,createdAt:saved.createdAt});return result;
  });
}
export function inventorySnapshot(s: State) {
  const skus=list(s,'sku'),places=locations(s);
  return {skus,suppliers:list(s,'supplier'),receipts:list(s,'stockReceipt'),movements:list(s,'stockMovement'),sales:list(s,'retailSale'),returns:list(s,'retailReturn'),actions:list(s,'retailAction'),stock:skus.flatMap(sku=>places.map(l=>({skuId:sku.id,locationId:l.id,onHand:onHand(s,sku.id,l.id),low:onHand(s,sku.id,l.id)<=sku.lowStock})))};
}

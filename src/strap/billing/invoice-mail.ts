import type { Bindings } from '../../auth.server';
// @ts-ignore Pinned Base mail module has no TypeScript declarations.
import { createMailSender } from '../../modules/mail/index.mjs';
import { memberMail } from '../domain/notices';
import { load, Transaction } from '../domain/store';
import { DomainError, humanOwner, insist, list, now, person, type Actor, type RecordData } from '../domain/types';
import { requireStaffRight } from '../domain/staff-rights';
import { staffChannel } from '../domain/staff-actions';
import { memberMailConfigured } from '../notice-mail';
import { renderInvoiceCopy } from '../ui/invoice-copy';
import { digest } from './model';
import { invoiceAccess } from './invoice-sources';
import { invoiceDocument } from './invoice-documents';

async function mailHash(env:Bindings,state:Transaction['state']) {
  insist(memberMailConfigured(env),'invoice_mail_not_configured',409);
  const mail=memberMail(state);insist(mail?.origin===env.AUTH_ORIGIN && mail.connectedBy!=='first-use','invoice_mail_review_required',409);
  return digest({origin:env.AUTH_ORIGIN,mail,provider:env.MAIL_PROVIDER,key:env.MAIL_API_KEY,from:env.MAIL_FROM,relay:env.MAIL_RELAY_URL,account:env.MAIL_ACCOUNT_ID});
}
export async function reviewInvoiceMail(env:Bindings,who:Actor) {
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);humanOwner(tx.who);
  const hash=await mailHash(env,tx.state);
  tx.sql.push(tx.statement("INSERT INTO st_invoice_mail_review(id,origin,authority_hash) VALUES('mail',?,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin,authority_hash=excluded.authority_hash",env.AUTH_ORIGIN,hash));await tx.commit();
}
async function authority(env:Bindings,state:Transaction['state']) {
  const hash=await mailHash(env,state),review=await env.DB.prepare("SELECT authority_hash,origin FROM st_invoice_mail_review WHERE id='mail'").first<{authority_hash:string;origin:string}>();
  insist(review?.authority_hash===hash && review.origin===env.AUTH_ORIGIN,'invoice_mail_review_required',409);return hash;
}
export async function invoiceMailStatus(env:Bindings,who:Actor) {
  const loaded=await load(env.DB,who);humanOwner(loaded.who);let reviewed=false;
  try{await authority(env,loaded.state);reviewed=true;}catch(e){if(!(e instanceof DomainError) || !['invoice_mail_not_configured','invoice_mail_review_required'].includes(e.code))throw e;}
  return {configured:memberMailConfigured(env),reviewed};
}
function authorized(tx:Transaction,input:Record<string,unknown>,staff:boolean) {
  if(staff)requireStaffRight(tx.state,tx.who,'sale');
  else insist(tx.who.role==='member','member_authorization_required',403);
  const pack=invoiceAccess(tx.state,tx.who,input.packId,staff),member=person(tx.state,pack.personId);
  if(staff){requireStaffRight(tx.state,tx.who,'sale',member.id,pack.locationId ?? 'studio');insist(input.requested===true,'invoice_member_request_required');staffChannel(input);}
  else insist(tx.who.role==='member' && tx.who.personId===member.id,'member_authorization_required',403);
  insist(member.email,'invoice_member_address_required',409);return {pack,member};
}
/** Explicit sends only: the current address is derived and fenced, never supplied by a caller. */
export async function sendInvoiceDocument(env:Bindings,who:Actor,input:Record<string,unknown>,staff=false) {
  let loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);
  if(staff)requireStaffRight(tx.state,tx.who,'sale');else insist(tx.who.role==='member','member_authorization_required',403);
  insist(Object.keys(input).every(k=>['packId','receiptId','requestId','requested','channel'].includes(k)),'invoice_recipient_override_refused');
  insist(typeof input.requestId==='string' && input.requestId.length>0 && input.requestId.length<=100,'invalid_requestId');
  const {pack,member}=authorized(tx,input,staff);
  const hash=await authority(env,tx.state),id='invoice-delivery:'+await digest({actorId:who.id,requestId:input.requestId}),basis=JSON.stringify(input),prior=tx.state.records.get(id)?.data;
  if(prior){insist(prior.requestBasis===basis,'invoice_delivery_request_changed',409);return prior;}
  const invoice=invoiceDocument(tx.state,tx.who,pack.id),receipt=input.receiptId?invoice.receipts.find(r=>r.id===input.receiptId):undefined;
  insist(!input.receiptId || receipt,'invoice_receipt_not_found',404);
  const document=renderInvoiceCopy(invoice as any,receipt),documentHash=await digest(document),saved={id,invoiceId:pack.id,receiptId:receipt?.id ?? null,personId:member.id,requestId:input.requestId,requestBasis:basis,staffMade:staff,actorId:who.id,channel:staff?staffChannel(input):'member-self-service',status:'queued',createdAt:now()};
  tx.put('invoiceDelivery',saved);
  if(staff)tx.put('staffAction',{id:'invoice-send:'+id,command:'billing.receipt.send.staff',action:'billing.receipt.send.staff',actorId:who.id,actorRole:who.role,staffMade:true,right:'sale',personId:member.id,channel:saved.channel,before:{invoiceId:pack.id,receiptId:receipt?.id ?? null},after:{deliveryId:id,status:'queued',memberAddressOnFile:true},requestId:input.requestId,at:saved.createdAt});
  tx.sql.push(tx.statement("INSERT INTO st_invoice_dispatches(id,origin,authority_hash,person_id,person_version,recipient,document_hash,status) VALUES(?,?,?,?,?,?,?,'queued')",id,env.AUTH_ORIGIN,hash,member.id,member.version,member.email,documentHash));
  await tx.commit();
  // Re-read current authority and source immediately before the once-only provider claim.
  loaded=await load(env.DB,who);tx=new Transaction(env.DB,loaded.state,loaded.who);const fresh=authorized(tx,input,staff),currentHash=await authority(env,tx.state);
  insist(currentHash===hash && fresh.member.version===member.version && fresh.member.email===member.email,'invoice_delivery_source_changed',409);
  const current=invoiceDocument(tx.state,tx.who,pack.id),currentReceipt=receipt?current.receipts.find(r=>r.id===receipt.id):undefined;
  insist(await digest(renderInvoiceCopy(current as any,currentReceipt))===documentHash,'invoice_document_changed',409);
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_invoice_dispatches WHERE id=? AND origin=? AND authority_hash=? AND status='queued') AND EXISTS(SELECT 1 FROM st_invoice_mail_review WHERE id='mail' AND authority_hash=? AND origin=?) AND EXISTS(SELECT 1 FROM st_people WHERE id=? AND version=? AND email=? AND active=1 AND erased_at IS NULL) THEN 1 ELSE 0 END",id,env.AUTH_ORIGIN,hash,hash,env.AUTH_ORIGIN,member.id,member.version,member.email));
  tx.sql.push(tx.statement("UPDATE st_invoice_dispatches SET status='sending' WHERE id=? AND status='queued'",id));
  await tx.commit();
  let result:{status:string;providerMessageId?:string|null}={status:'uncertain'};
  const usd=(n:number)=>'$'+(n/100).toFixed(2)+' USD';
  const text=[invoice.studio.legalName,invoice.memberName,receipt?'Payment receipt':'Invoice',...invoice.lines.map(l=>l.label+': '+usd(l.amountCents)),...invoice.receipts.filter(r=>!receipt || r.id===receipt.id).map(r=>r.tender+': '+usd(r.amountCents)+' — '+r.status),...invoice.refunds.map(r=>'Refund: '+usd(r.amountCents)+' — '+r.status),'Original invoice: '+usd(invoice.totalCents),'Balance: '+usd(invoice.balanceCents),invoice.taxStatus==='not_assessed'?'Tax not assessed':'Tax supported by retained provider evidence',invoice.studio.receiptDetails].join('\n');
  try {
    const sender=createMailSender({provider:env.MAIL_PROVIDER,mode:'production',apiKey:env.MAIL_API_KEY,...(env.MAIL_PROVIDER==='rer'?{relayUrl:env.MAIL_RELAY_URL}:{}),...(env.MAIL_PROVIDER==='cloudflare'?{accountId:env.MAIL_ACCOUNT_ID}:{})});
    result=await sender.send({deliveryId:id,...(env.MAIL_PROVIDER==='rer'?{messageKey:id}:{}),from:env.MAIL_FROM,to:[member.email],subject:'Your requested studio '+(receipt?'payment receipt':'invoice'),text,html:document});
  }catch{/* An uncertain submission is retained and is never retried automatically. */}
  const status=['accepted','rejected','rate_limited','uncertain'].includes(result.status)?result.status:'uncertain';
  await env.DB.prepare("UPDATE st_invoice_dispatches SET status=?,provider_message_id=? WHERE id=? AND status='sending'").bind(status,result.providerMessageId ?? null,id).run();
  loaded=await load(env.DB,who);tx=new Transaction(env.DB,loaded.state,loaded.who);
  const retained=tx.state.records.get(id)!.data,completed={...retained,status,provider:env.MAIL_PROVIDER,providerMessageId:result.providerMessageId ?? null,finishedAt:now()};tx.put('invoiceDelivery',completed);await tx.commit();return completed;
}

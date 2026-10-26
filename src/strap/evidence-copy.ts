import type { Bindings } from '../auth.server';
// @ts-ignore The pinned Base mail module is JavaScript without declarations here.
import { createMailSender } from '../modules/mail/index.mjs';
import { memberMail } from './domain/notices';
import { loadSystem, Transaction } from './domain/store';
import { humanOwner, id, insist, list, now, person, record, type RecordData, type State } from './domain/types';
import { memberMailConfigured } from './notice-mail';
import { sha256Hex } from './security/crypto';
import { assembleWaiverEvidence, renderWaiverCopy } from './waiver-evidence';

export const evidenceCopyPath='/evidence/copy';
const lifetime=15*60_000;
type MailReview={connection_id:string;origin:string;review_hash:string;provider_hash:string;approved_by:string};
type CopyRow={id:string;receipt_id:string;document_id:string;document_hash:string;receipt_hash:string;person_id:string;person_version:number;recipient:string;origin:string;connection_id:string;token_hash:string;delivery_status:string};
export type CopyDispatchStatus='accepted'|'rejected'|'rate_limited'|'uncertain'|'blocked';
export type PreparedEvidenceCopy={dispatch:()=>Promise<CopyDispatchStatus>};

const reviewHash=(connection: RecordData)=>sha256Hex(JSON.stringify({origin:connection.origin,connectedAt:connection.connectedAt,connectedBy:connection.connectedBy}));
const providerHash=(env: Bindings)=>sha256Hex(JSON.stringify({origin:env.AUTH_ORIGIN,provider:env.MAIL_PROVIDER,from:env.MAIL_FROM,key:env.MAIL_API_KEY,relay:env.MAIL_RELAY_URL,account:env.MAIL_ACCOUNT_ID}));
const isDependent=(state: State,personId: string)=>list(state,'household').some(home=>home.guardianIds.length && home.participantIds.includes(personId)) || list(state,'contractAuthority').some(authority=>authority.personId===personId && authority.kind==='minor-guardian' && !authority.revokedAt && (!authority.adultAt || authority.adultAt>now()));
const hasTabletCookie=(request: Request)=>(request.headers.get('cookie')??'').split(/;\s*/).some(part=>part.startsWith('strap_intake_tablet='));

/** Separate native-owner command; its HTTP door must require MFA.
 * It reviews configured mail for copy links without changing ordinary mail settings. */
export async function reviewEvidenceCopyMail(tx: Transaction,env: Bindings,input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(input.confirm===true,'copy_mail_review_confirmation_required');
  insist(memberMailConfigured(env),'copy_mail_provider_not_configured',409);
  const connection=memberMail(tx.state);
  insist(connection?.origin===env.AUTH_ORIGIN && connection.connectedBy && connection.connectedBy!=='first-use','copy_mail_review_required',409);
  tx.sql.push(tx.statement("INSERT INTO st_evidence_copy_mail(id,connection_id,origin,review_hash,provider_hash,approved_by,approved_at) VALUES('mail',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id,origin=excluded.origin,review_hash=excluded.review_hash,provider_hash=excluded.provider_hash,approved_by=excluded.approved_by,approved_at=excluded.approved_at",
    id(),env.AUTH_ORIGIN,await reviewHash(connection),await providerHash(env),tx.who.id,now()));
  return {available:true,reviewedAt:now()};
}
async function reviewedMail(env: Bindings,state: State): Promise<MailReview|null> {
  if(!memberMailConfigured(env))return null;
  const connection=memberMail(state);
  if(!connection || connection.origin!==env.AUTH_ORIGIN || connection.connectedBy==='first-use')return null;
  const review=await env.DB.prepare("SELECT connection_id,origin,review_hash,provider_hash,approved_by FROM st_evidence_copy_mail WHERE id='mail'").first<MailReview>();
  return review && review.origin===env.AUTH_ORIGIN && review.review_hash===await reviewHash(connection) && review.provider_hash===await providerHash(env) ? review : null;
}

export async function evidenceCopyMailStatus(env: Bindings,state: State) {
  return {configured:memberMailConfigured(env),reviewed:!!await reviewedMail(env,state)};
}

/** UI availability never acquires authority or creates an account or credential. */
export async function evidenceCopyAvailable(env: Bindings,state: State,personId: string) {
  const member=state.people.find(p=>p.id===personId && p.active && !p.erasedAt && p.role==='member');
  return !!(member?.email && !isDependent(state,personId) && await reviewedMail(env,state));
}
function personalEvidence(state: State,receiptId: string) {
  const receipt=record(state,receiptId,'acknowledgement'),member=person(state,receipt.personId),document=record(state,receipt.waiverId,'waiver'),signature=receipt.signature;
  insist(member.role==='member' && member.email && !isDependent(state,member.id),'copy_participant_unavailable',409);
  insist(signature?.method==='typed-affirmation' && signature.channel==='desk-tablet' && signature.confirmed===true && signature.signerPersonId===member.id && signature.authority?.kind==='self' && signature.authority.adultConfirmed===true && receipt.actorId==='tablet:'+signature.deviceId,'copy_personal_adult_completion_required',409);
  insist(signature.documentHash===document.documentHash && signature.documentText===document.text && signature.documentVersion===document.version,'copy_document_changed',409);
  return {receipt,member,document,evidence:assembleWaiverEvidence(receipt,document)};
}
/** Freeze the exact source rows as well as the domain revision at the atomic write. */
function sourceFence(tx: Transaction,source: ReturnType<typeof personalEvidence>,row: Pick<CopyRow,'person_id'|'person_version'|'recipient'>) {
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_people WHERE id=? AND version=? AND email=? AND role='member' AND active=1 AND erased_at IS NULL) AND EXISTS(SELECT 1 FROM st_records WHERE id=? AND kind='acknowledgement' AND data=?) AND EXISTS(SELECT 1 FROM st_records WHERE id=? AND kind='waiver' AND data=?) THEN 1 ELSE 0 END",
    row.person_id,row.person_version,row.recipient,source.receipt.id,JSON.stringify(source.receipt),source.document.id,JSON.stringify(source.document)));
}
function mailFence(tx: Transaction,review: MailReview) {
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_evidence_copy_mail WHERE id='mail' AND connection_id=? AND origin=? AND review_hash=? AND provider_hash=?) THEN 1 ELSE 0 END",review.connection_id,review.origin,review.review_hash,review.provider_hash));
}

/** Call after putting the personal receipt and before committing the tablet transaction.
 * Only the separately checked request authorizes a send. The result contains no URL or token. */
export async function prepareEvidenceCopy(tx: Transaction,env: Bindings,receiptId: string,input: Record<string,unknown>): Promise<PreparedEvidenceCopy|null> {
  if(input.emailCopy!=='yes')return null;
  const source=personalEvidence(tx.state,receiptId),review=await reviewedMail(env,tx.state);
  insist(review,'copy_mail_review_required',409);
  const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const created=now(),copy:CopyRow={id:id(),receipt_id:source.receipt.id,document_id:source.document.id,document_hash:source.document.documentHash,receipt_hash:await sha256Hex(JSON.stringify(source.evidence)),person_id:source.member.id,person_version:source.member.version,recipient:source.member.email!,origin:env.AUTH_ORIGIN,connection_id:review.connection_id,token_hash:await sha256Hex(secret),delivery_status:'queued'};
  sourceFence(tx,source,copy);mailFence(tx,review);
  tx.sql.push(tx.statement("INSERT INTO st_evidence_copies(id,receipt_id,document_id,document_hash,receipt_hash,person_id,person_version,recipient,origin,connection_id,token_hash,created_at,expires_at,delivery_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'queued')",copy.id,copy.receipt_id,copy.document_id,copy.document_hash,copy.receipt_hash,copy.person_id,copy.person_version,copy.recipient,copy.origin,copy.connection_id,copy.token_hash,created,new Date(Date.parse(created)+lifetime).toISOString()));
  let invoked=false;
  return {dispatch:async()=>{
    if(invoked)return 'blocked';invoked=true;
    return dispatchCopy(env,copy,secret);
  }};
}
async function checkedSource(state: State,row: CopyRow) {
  const source=personalEvidence(state,row.receipt_id);
  insist(source.member.id===row.person_id && source.member.version===row.person_version && source.member.email===row.recipient && source.document.id===row.document_id && source.document.documentHash===row.document_hash && await sha256Hex(JSON.stringify(source.evidence))===row.receipt_hash,'copy_unavailable',410);
  return source;
}
async function dispatchCopy(env: Bindings,row: CopyRow,secret: string): Promise<CopyDispatchStatus> {
  try {
    const loaded=await loadSystem(env.DB),tx=new Transaction(env.DB,loaded.state,loaded.who),source=await checkedSource(tx.state,row),review=await reviewedMail(env,tx.state);
    insist(review?.connection_id===row.connection_id && row.origin===env.AUTH_ORIGIN,'copy_mail_review_required',409);
    sourceFence(tx,source,row);mailFence(tx,review);
    tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_evidence_copies WHERE id=? AND delivery_status='queued' AND consumed_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE 0 END",row.id));
    tx.sql.push(tx.statement("UPDATE st_evidence_copies SET delivery_status='sending',attempted_at=? WHERE id=? AND delivery_status='queued'",now(),row.id));
    await tx.commit();
  }catch {
    await env.DB.prepare("UPDATE st_evidence_copies SET delivery_status='blocked',code='copy_dispatch_refused',finished_at=? WHERE id=? AND delivery_status='queued'").bind(now(),row.id).run();return 'blocked';
  }
  let status:CopyDispatchStatus='uncertain',providerMessageId:string|null=null;
  try {
    const sender=createMailSender({provider:env.MAIL_PROVIDER,mode:'production',apiKey:env.MAIL_API_KEY,...(env.MAIL_PROVIDER==='rer'?{relayUrl:env.MAIL_RELAY_URL}:{}),...(env.MAIL_PROVIDER==='cloudflare'?{accountId:env.MAIL_ACCOUNT_ID}:{})});
    const result=await sender.send({deliveryId:row.id,...(env.MAIL_PROVIDER==='rer'?{messageKey:row.id}:{}),from:env.MAIL_FROM,to:[row.recipient],subject:'Your requested document copy',text:`You requested a private copy after personally affirming a studio document. This link permits only that recorded copy, expires 15 minutes after your request and downloads once. Email-link possession does not independently verify the original tablet identity.\n\n${env.AUTH_ORIGIN}${evidenceCopyPath}?token=${secret}\n\nThis link does not sign you in or authorize any payment.`});
    if(['accepted','rejected','rate_limited','uncertain'].includes(result.status))status=result.status;
    providerMessageId=result.providerMessageId??null;
  }catch { /* One uncertain submission is never automatically repeated. */ }
  await env.DB.prepare("UPDATE st_evidence_copies SET delivery_status=?,provider=?,provider_message_id=?,code=?,finished_at=? WHERE id=? AND delivery_status='sending'").bind(status,env.MAIL_PROVIDER??null,providerMessageId,status==='uncertain'?'provider_outcome_unknown':null,now(),row.id).run();
  return status;
}

const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const page=(body: string,status=200)=>new Response(`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Private document copy</title><style>body{max-width:640px;margin:48px auto;padding:0 20px;font:16px/1.6 system-ui,sans-serif}button{font:inherit;padding:12px 20px}</style></head><body><main>${body}</main></body></html>`,{status,headers});
/** A capability door independent of native accounts; it never grants private navigation. */
export async function evidenceCopyResponse(request: Request,env: Bindings): Promise<Response> {
  try {
    const url=new URL(request.url);
    insist(url.origin===env.AUTH_ORIGIN && (!request.headers.has('host') || request.headers.get('host')===url.host),'wrong_origin',403);
    insist(url.pathname===evidenceCopyPath && ['GET','POST'].includes(request.method),'method_not_allowed',405);
    insist(!hasTabletCookie(request),'copy_private_device_required',403);
    if(request.method==='POST')insist(request.headers.get('origin')===env.AUTH_ORIGIN && request.headers.get('sec-fetch-site')!=='cross-site','cross_site_refused',403);
    const body=request.method==='POST'?await request.text():'';
    insist(body.length<=2000,'copy_unavailable',410);
    const secret=request.method==='GET'?url.searchParams.get('token')??'':new URLSearchParams(body).get('token')??'';
    insist(/^[0-9a-f]{64}$/.test(secret),'copy_unavailable',410);
    const row=await env.DB.prepare("SELECT * FROM st_evidence_copies WHERE token_hash=? AND consumed_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND delivery_status IN ('sending','accepted','uncertain')").bind(await sha256Hex(secret)).first<CopyRow>();
    insist(row?.origin===env.AUTH_ORIGIN,'copy_unavailable',410);
    const loaded=await loadSystem(env.DB),tx=new Transaction(env.DB,loaded.state,loaded.who),source=await checkedSource(tx.state,row);
    if(request.method==='GET')return page(`<h1>Your private document copy</h1><p>Download the exact copy requested after tablet completion. This link downloads once and grants no studio account access.</p><form method="post" action="${evidenceCopyPath}"><input type="hidden" name="token" value="${secret}"><button type="submit">Download my document copy</button></form>`);
    sourceFence(tx,source,row);
    tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_evidence_copies WHERE id=? AND token_hash=? AND consumed_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND delivery_status IN ('sending','accepted','uncertain')) THEN 1 ELSE 0 END",row.id,row.token_hash));
    tx.sql.push(tx.statement('UPDATE st_evidence_copies SET consumed_at=? WHERE id=? AND consumed_at IS NULL',now(),row.id));
    await tx.commit();
    return new Response(renderWaiverCopy(source.evidence),{headers:{...headers,'content-disposition':'attachment; filename=strap-document-copy.html','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"}});
  }catch(error) {
    const code=(error as {code?:string}).code,status=Number((error as {status?:number}).status);
    const response=page('<h1>Document copy unavailable</h1><p>This private link cannot be used. It may have expired or already been downloaded. No studio records are available here.</p>',status===403||status===405?status:410);
    response.headers.set('x-strap-refusal',code==='copy_private_device_required'?code:'copy_unavailable');return response;
  }
}

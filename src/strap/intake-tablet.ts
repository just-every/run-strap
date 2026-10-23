import { fontHead } from '../base/font-head';
import { operatorAuth, type Bindings } from '../auth.server';
import { loadSystem, Transaction } from './domain/store';
import { id, insist, now, person, record, text, type RecordData } from './domain/types';
import { requireMemberRecord } from './domain/member-records';
import { submitIntake } from './domain/intake';
import { h, hidden, textarea } from './ui/shared';

export const tabletCookie='strap_intake_tablet';
const tokenOf=(request: Request) => (request.headers.get('cookie') ?? '').split(/;\s*/).find(part => part.startsWith(tabletCookie+'='))?.slice(tabletCookie.length+1) ?? '';
const hash=async(token: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2,'0')).join('');
const token=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'strict-origin','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const page=(body: string,status=200)=>new Response(`<!doctype html><html lang="en-US"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private intake · Strap</title><link rel="stylesheet" href="/rer-theme.css">${fontHead}<link rel="stylesheet" href="/brand/app/shell.css"><link rel="stylesheet" href="/brand/app/pages.css"><link rel="stylesheet" href="/brand/app/intake-tablet.css"></head><body><main class="intake-tablet page single"><section class="panel"><div class="panel-body">${body}</div></section></main></body></html>`,{status,headers});
export const lockedTablet=()=>page('<h1>Tablet locked</h1><p>This device has no access to member records. Ask studio staff to open the next intake form.</p>',403);
/** A dedicated, signed-out tablet cannot reach native sign-in or private product doors. */
export function intakeTabletGuard(request: Request) {
  if(!tokenOf(request))return null;
  const path=new URL(request.url).pathname;
  if(path === '/intake/tablet' || path === '/intake/tablet/start' || path === '/rer-theme.css' || path.startsWith('/brand/') || path.startsWith('/fonts/'))return null;
  return lockedTablet();
}
export async function launchIntakeTablet(tx: Transaction,input: Record<string,unknown>) {
  requireMemberRecord(tx.state,tx.who,input.personId);text(input.requestId,'requestId',100);
  const member=person(tx.state,input.personId),form=record(tx.state,input.formId,'intakeForm');
  insist(member.role === 'member','member_required');
  insist(record(tx.state,form.seriesId,'intakeSeries').currentFormId === form.id,'intake_form_changed',409);
  const secret=token(),launch={id:id(),personId:member.id,formId:form.id,seriesId:form.seriesId,version:form.version,status:'issued',at:now(),expiresAt:new Date(Date.now()+15*60000).toISOString(),actorId:tx.who.id,actorRole:tx.who.role,staffPersonId:tx.who.personId ?? null};
  tx.put('intakeTabletLaunch',launch);
  tx.sql.push(tx.statement('INSERT INTO st_intake_tablets(id,token_hash,expires_at) VALUES(?,?,?)',launch.id,await hash(secret),launch.expiresAt));
  return {...launch,url:'/intake/tablet/start?token='+secret};
}
function liveLaunch(tx: Transaction,row: RecordData) {
  const launch=record(tx.state,row.id,'intakeTabletLaunch'),member=person(tx.state,launch.personId),form=record(tx.state,launch.formId,'intakeForm');
  insist(member.role === 'member' && record(tx.state,form.seriesId,'intakeSeries').currentFormId === form.id,'intake_form_changed',409);
  requireMemberRecord(tx.state,{id:launch.actorId,role:launch.actorRole,isOwner:launch.actorRole === 'owner',personId:launch.staffPersonId,email:''},member.id);
  return {launch,member,form};
}
async function nativeCreatorActive(tx: Transaction,launch: RecordData) {
  const native=await tx.db.prepare('SELECT role,status FROM oa_operators WHERE id=?').bind(launch.actorId).first<{role:string;status:string}>();
  insist(native?.status === 'active' && (launch.actorRole !== 'owner' || native.role === 'owner'),'intake_staff_authority_ended',403);
  if(launch.staffPersonId) person(tx.state,launch.staffPersonId);
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role=?) THEN 1 ELSE 0 END",launch.actorId,native.role));
}
export async function intakeTabletResponse(request: Request,env: Bindings) {
  const url=new URL(request.url),path=url.pathname;
  try {
    insist(url.origin === env.AUTH_ORIGIN && (!request.headers.has('host') || request.headers.get('host') === url.host),'wrong_origin',403);
    insist(['GET','POST'].includes(request.method),'method_not_allowed',405);
    if(request.method === 'POST')insist(request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site','cross_site_refused',403);
    insist(!await operatorAuth(env).getSession(request),'use_a_signed_out_dedicated_tablet',403);
    const body=request.method === 'POST'?await request.text():'';insist(body.length <= 60000,'intake_request_too_large',413);
    const input=Object.fromEntries(new URLSearchParams(body)),secret=path === '/intake/tablet/start' ? request.method === 'POST' ? input.token : url.searchParams.get('token') ?? '' : tokenOf(request);
    insist(/^[0-9a-f]{64}$/.test(secret),'tablet_unavailable',410);
    const row=await env.DB.prepare("SELECT * FROM st_intake_tablets WHERE token_hash=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND consumed_at IS NULL").bind(await hash(secret)).first<RecordData>();
    insist(row,'tablet_unavailable',410);
    const loaded=await loadSystem(env.DB),tx=new Transaction(env.DB,loaded.state,loaded.who),{launch,member,form}=liveLaunch(tx,row);
    await nativeCreatorActive(tx,launch);
    if(path === '/intake/tablet/start') {
      insist(!row.paired_at,'tablet_unavailable',410);
      if(request.method === 'GET')return page(`<h1>Private intake</h1><p>Use this dedicated, signed-out tablet for ${h(member.name)} only. It exposes no earlier answers or member records and locks after submission.</p><form class="form" method="post" action="/intake/tablet/start">${hidden('token',secret)}<button class="btn" type="submit">Open this intake form</button></form>`);
      tx.sql.push(tx.statement('INSERT INTO st_assert(value) SELECT CASE WHEN paired_at IS NULL AND consumed_at IS NULL AND expires_at>? THEN 1 ELSE 0 END FROM st_intake_tablets WHERE id=?',now(),row.id));
      tx.sql.push(tx.statement('UPDATE st_intake_tablets SET paired_at=? WHERE id=?',now(),row.id));await tx.commit();
      return new Response(null,{status:303,headers:{location:'/intake/tablet','cache-control':'no-store','referrer-policy':'strict-origin','set-cookie':`${tabletCookie}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${url.protocol==='https:'?'; Secure':''}`}});
    }
    insist(row.paired_at,'tablet_unavailable',410);
    if(request.method === 'GET')return page(`<h1>${h(form.title)}</h1><p>For ${h(member.name)} · Version ${form.version}. No previous answers are shown. Only complete this form for yourself. Nothing here signs a waiver or grants payment authority.</p><form class="form" method="post" action="/intake/tablet">${form.questions.map((q: RecordData)=>textarea('answer_'+q.key,q.label+(q.sensitive?' (restricted)':''),'',`${q.required?'required':''} maxlength="2000"`)).join('')}<label class="check"><input type="checkbox" name="confirm" value="yes" required>I am ${h(member.name)} and these are my answers.</label><button class="btn" type="submit">Submit my intake and lock tablet</button></form>`);
    insist(input.confirm === 'yes','member_confirmation_required',400);
    submitIntake(tx,{formId:form.id,answers:Object.fromEntries(Object.entries(input).filter(([k])=>k.startsWith('answer_')).map(([k,v])=>[k.slice(7),v])),requestId:'tablet:'+launch.id},false,{id:launch.id,personId:member.id,launchedBy:launch.actorId});
    tx.sql.push(tx.statement('INSERT INTO st_assert(value) SELECT CASE WHEN consumed_at IS NULL AND expires_at>? THEN 1 ELSE 0 END FROM st_intake_tablets WHERE id=?',now(),row.id));
    tx.sql.push(tx.statement('UPDATE st_intake_tablets SET consumed_at=? WHERE id=?',now(),row.id));
    tx.put('intakeTabletLaunch',{...launch,status:'completed',completedAt:now()});await tx.commit();
    return page('<h1>Intake saved · tablet locked</h1><p>Your answers were saved. No member records are available here. Hand the tablet back to studio staff.</p>');
  }catch(error){const response=page('<h1>Tablet locked</h1><p>This form is unavailable or could not be saved. Ask studio staff for a new handoff. No member records are available here.</p>',Number((error as any).status)||500);response.headers.set('x-strap-refusal',(error as any).code ?? 'tablet_unavailable');return response;}
}

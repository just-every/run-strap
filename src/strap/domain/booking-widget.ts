import { sha256 } from '../../modules/import-kit/src/d1/index';
import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import { loadSystem, type Transaction } from './store';
import { seatCapacity } from './spots';
import { requireClassRight } from './staff-command-access';
import { currentWaivers, currentWaiverReceipt, eligiblePacks } from './bookings';
import { intakeMissing } from './intake';

const basis = (entry: RecordData) => sha256(JSON.stringify(entry));
const tokenHash = (token: unknown) => { insist(typeof token === 'string' && /^[0-9a-f]{64}$/.test(token),'selection_unavailable',410); return sha256(token); };
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function embeddingOrigins(value: unknown) {
  insist(Array.isArray(value) && value.length > 0 && value.length <= 20,'exact_embedding_origins_required');
  return [...new Set(value.map(raw=>{
    const origin=text(raw,'embedding_origin',250);let url: URL;
    try { url=new URL(origin); } catch { insist(false,'invalid_embedding_origin'); }
    insist(url!.origin===origin && !url!.username && !url!.password && (url!.protocol==='https:' || url!.protocol==='http:' && ['localhost','127.0.0.1'].includes(url!.hostname)),'exact_embedding_origin_required');
    return origin;
  }))];
}
export function saveWidgetSettings(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(typeof input.enabled==='boolean' && input.confirm===true,'publication_confirmation_required');
  const origins=embeddingOrigins(input.origins),previous=tx.state.records.get('widget-settings')?.data;
  const saved={id:'widget-settings',publicationId:id(),enabled:input.enabled,origins,revision:(previous?.revision??0)+1,publishedAt:now(),publishedBy:tx.who.id};
  tx.put('widgetSettings',saved);tx.put('widgetPublicationEvent',{...saved,id:id(),settingsId:saved.id});
  tx.sql.push(tx.statement('INSERT INTO st_widget_connections(id,publication_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET publication_id=excluded.publication_id',saved.publicationId));
  return saved;
}
export function publishWidgetClass(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const entry=record(tx.state,input.classId,'class');
  insist(entry.status==='published' && !entry.privatePersonId && entry.start>now(),'public_class_required',409);
  insist(typeof input.approved==='boolean','publication_confirmation_required');
  const saved={id:'widget-class:'+entry.id,classId:entry.id,sourceBasis:basis(entry),description:text(input.description,'public_description',2000),approved:input.approved,publishedAt:now(),publishedBy:tx.who.id};
  tx.put('widgetClass',saved);tx.put('widgetPublicationEvent',{...saved,id:id(),publicationId:saved.id});return saved;
}
export function publishWidgetInstructor(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const instructor=person(tx.state,input.instructorId);
  insist(instructor.role==='instructor','instructor_required');insist(typeof input.approved==='boolean','publication_confirmation_required');
  const saved={id:'widget-instructor:'+instructor.id,instructorId:instructor.id,publicName:text(input.publicName,'public_name',160),bio:text(input.bio,'public_bio',2000),approved:input.approved,publishedAt:now(),publishedBy:tx.who.id};
  tx.put('widgetInstructor',saved);tx.put('widgetPublicationEvent',{...saved,id:id(),publicationId:saved.id});return saved;
}
export async function widgetPublication(db: D1Database, state: State) {
  const settings=state.records.get('widget-settings')?.data;
  const connection=await db.prepare('SELECT publication_id FROM st_widget_connections WHERE id=1').first<{publication_id:string}>();
  insist(settings?.enabled && connection?.publication_id===settings.publicationId,'schedule_unavailable',404);
  // Removing the publishing owner also withdraws their public authority immediately.
  insist(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(settings.publishedBy).first(),'schedule_unavailable',404);
  return settings;
}
function publishedClass(state: State, classId: unknown) {
  const entry=record(state,classId,'class'),publication=state.records.get('widget-class:'+entry.id)?.data;
  const instructor=state.people.find(p=>p.id===entry.instructorId && p.active && !p.erasedAt && p.role==='instructor');
  const bio=state.records.get('widget-instructor:'+entry.instructorId)?.data;
  insist(entry.status==='published' && !entry.privatePersonId && entry.start>now() && publication?.approved && publication.sourceBasis===basis(entry),'class_publication_changed',409);
  return {entry,publication,bio:instructor && bio?.approved ? bio : null};
}
export async function publicSchedule(db: D1Database, embeddingOrigin: string) {
  const {state}=await loadSystem(db),settings=await widgetPublication(db,state);
  insist(settings.origins.includes(embeddingOrigin),'embedding_origin_refused',403);
  const classes=list(state,'widgetClass').flatMap(publication=>{
    try {
      const {entry,bio}=publishedClass(state,publication.classId);
      return [{id:entry.id,title:entry.title,service:entry.service,start:entry.start,end:entry.end,timeZone:entry.timeZone??'UTC',description:publication.description,publicationKey:basis(publication),instructor:bio ? {name:bio.publicName,bio:bio.bio} : null,available:seatCapacity(state,entry).onlineOpen>0}];
    } catch { return []; }
  }).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
  return {settings,classes};
}
export async function selectWidgetClass(db: D1Database, input: URLSearchParams) {
  const origin=input.get('embeddingOrigin')??'',schedule=await publicSchedule(db,origin);
  const choice=schedule.classes.find(c=>c.id===input.get('classId') && c.publicationKey===input.get('publicationKey'));
  insist(choice,'class_publication_changed',409);insist(choice.available,'class_full',409);
  const token=randomToken(),expiresAt=new Date(Date.now()+15*60_000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM st_widget_selections WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')"),
    db.prepare('INSERT INTO st_widget_selections(token_hash,publication_id,class_id,class_basis,expires_at) VALUES(?,?,?,?,?)').bind(tokenHash(token),schedule.settings.publicationId,choice.id,choice.publicationKey,expiresAt),
  ]);
  return {token,expiresAt};
}
export async function widgetSelection(db: D1Database, state: State, token: unknown) {
  const settings=await widgetPublication(db,state);
  const selection=await db.prepare("SELECT * FROM st_widget_selections WHERE token_hash=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND consumed_at IS NULL").bind(tokenHash(token)).first<RecordData>();
  insist(selection && selection.publication_id===settings.publicationId,'selection_unavailable',410);
  const selected=publishedClass(state,selection.class_id);
  insist(basis(selected.publication)===selection.class_basis,'class_publication_changed',409);
  insist(seatCapacity(state,selected.entry).onlineOpen>0,'class_full',409);
  return {...selected,selection};
}
export function widgetAdult(state: State, personId: string) {
  person(state,personId);
  insist(!list(state,'household').some(h=>h.guardianIds?.length && h.participantIds?.includes(personId)) && !list(state,'contractAuthority').some(g=>g.personId===personId && g.kind==='minor-guardian' && !g.revokedAt && (!g.adultAt || g.adultAt>now())),'adult_personal_booking_required',403);
}
/** Personal prerequisites are read from current records, never from the selection. */
export function widgetPrerequisites(state: State, personId: string, entry: RecordData) {
  const member=person(state,personId),service=String(entry.service??entry.title?.split(' · ')[0]).trim().replace(/\s+/g,' ').toLowerCase();
  const packs=eligiblePacks(state,personId,entry);
  return {
    memberName:member.name,
    documents:currentWaivers(state).filter(w=>!w.service || String(w.service).trim().replace(/\s+/g,' ').toLowerCase()===service)
      .map(w=>({...w,completed:currentWaiverReceipt(state,personId,w)})),
    forms:intakeMissing(state,personId,[String(entry.service??entry.title?.split(' · ')[0])]),
    hasAccess:packs.length>0,
    invoices:list(state,'stripeInvoice').filter(i=>i.personId===personId && i.status==='open' && packs.some(p=>p.id===i.packId)).map(i=>({id:i.id,amountCents:i.amountCents})),
  };
}
/** Selection adds no authority. Both established booking commands still run their own fences and staff audit. */
export async function validateWidgetBooking(tx: Transaction, name: string, input: Record<string,unknown>) {
  if (input.selection===undefined) return;
  insist(name==='booking.book' || name==='booking.desk','selection_booking_required',403);
  const selected=await widgetSelection(tx.db,tx.state,input.selection);
  insist(selected.entry.id===input.classId && !input.participantId && !input.override && (!input.pay || input.pay==='auto') && !input.waitlist,'selection_changed',409);
  const memberId=name==='booking.book' ? tx.who.personId : String(input.personId??'');
  insist(memberId,'member_required',403);widgetAdult(tx.state,memberId);
  if(name==='booking.book')insist(input.adultConfirmed===true,'adult_personal_confirmation_required');
  else requireClassRight(tx,'booking',memberId,selected.entry);
  tx.future(selected.selection.expires_at);
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN consumed_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END FROM st_widget_selections WHERE token_hash=?",tokenHash(input.selection)));
  tx.sql.push(tx.statement('UPDATE st_widget_selections SET consumed_at=? WHERE token_hash=?',now(),tokenHash(input.selection)));
  input.selectionHash=tokenHash(input.selection);delete input.selection;
}
export const widgetSettingsView = async (db: D1Database, state: State, who: Actor) => who.role==='owner' && who.isOwner ? {
  settings:state.records.get('widget-settings')?.data??null,classes:list(state,'widgetClass'),instructors:list(state,'widgetInstructor'),
  connected:!!await db.prepare('SELECT 1 FROM st_widget_connections WHERE id=1 AND publication_id=?').bind(state.records.get('widget-settings')?.data.publicationId??'').first(),
} : null;

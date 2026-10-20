import { localDate, mondayOf } from '../zone';
import { checkAllocations, classFields } from './classes';
import { approveDraft } from './drafts';
import { mailBasis, seriesBasis } from './series-model';
import { applyChangeNotices, changeImpact } from './series-effects';
import { schedulingConflicts } from './scheduling';
import { seatCapacity } from './spots';
import { studioSettings } from './studio';
import { qualifiedForService } from './substitutions';
import { humanOwner, id, insist, list, now, preparer, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { mailNotConfigured, type NoticeContext } from './notices';

/** Facts, not a forecast: each count retains the public source identities. */
export function demandEvidence(state: State, classIds?: string[]) {
  const bookings = list(state,'booking');
  return list(state,'class').filter(c => c.status === 'published' && (!classIds || classIds.includes(c.id))).map(c => {
    const seats = bookings.filter(b => b.classId === c.id), capacity = seatCapacity(state,c);
    return {classId:c.id,title:c.title,service:c.service,start:c.start,end:c.end,instructorId:c.instructorId,
      capacity:capacity.total,reserved:capacity.booked,offered:capacity.offered,open:capacity.totalOpen,
      waiting:seats.filter(b => b.status === 'waitlisted').length,
      attended:seats.filter(b => b.attendance === 'attended').length,noShows:seats.filter(b => b.attendance === 'no_show').length,
      bookings:seats.map(b => ({id:b.id,status:b.status,attendance:b.attendance ?? null})),
      substitutions:c.substitutionHistory ?? []};
  }).sort((a,b) => a.classId.localeCompare(b.classId));
}

/** Recorded exceptions are private only as to their reasons (SCHED-003). */
export function demandAvailability(state: State) {
  return list(state,'unavailability').filter(r => r.status === 'active').map(({reason,updatedBy,...r}) => r);
}
async function demandBasis(state: State) {
  return JSON.stringify({schedule:await seriesBasis(state),
    qualifications:list(state,'substitutionQualification').sort((a,b) => a.id.localeCompare(b.id))});
}
function availableInstructors(state: State, entry: RecordData, excluded: string[]) {
  return state.people.filter(p => p.role === 'instructor' && p.active && !p.erasedAt).map(p => ({
    instructorId:p.id,instructorName:p.name,
    available:!schedulingConflicts([{...entry,instructorId:p.id,instructorName:p.name}],list(state,'class').filter(c => c.status !== 'cancelled' && !excluded.includes(c.id)),list(state,'unavailability')).length,
    studioQualified:qualifiedForService(state,p.id,entry.service),
  }));
}

/** The connected agent supplies the proposal; Strap freezes its cited facts and
 * evaluates it with the same capacity, credit, resource and notification rules. */
export async function prepareRecommendation(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  preparer(tx.who);
  const action = text(input.action,'recommendation_action',20);
  insist(['additional','retime','coverage'].includes(action),'invalid_recommendation_action');
  insist(Array.isArray(input.sourceClassIds) && input.sourceClassIds.length > 0 && input.sourceClassIds.length <= 100,'source_classes_required');
  const sources = [...new Set(input.sourceClassIds.map(value => text(value,'source_class_id',100)))];
  for (const source of sources) insist(record(tx.state,source,'class').status === 'published','published_source_required');
  const reason = text(input.reason,'recommendation_reason',1000), proposal = input.proposal as Record<string,unknown>;
  insist(proposal && typeof proposal === 'object' && !Array.isArray(proposal),'invalid_recommendation_proposal');
  const before = action === 'additional' ? null : record(tx.state,input.classId,'class');
  if (before) {
    insist(before.status === 'published' && before.start > now(),'class_must_be_future',409);
    insist(sources.includes(before.id),'target_must_be_cited');
    insist(Object.keys(proposal).every(key => (action === 'coverage' ? ['instructorId'] : ['start','end']).includes(key)),'invalid_recommendation_change');
  }
  const fields = classFields(tx,{...(before ?? {}),...proposal});
  const zone = studioSettings(tx.state)?.timeZone ?? 'UTC', date = localDate(fields.start,zone);
  const after: RecordData = {...(before ?? {}),...fields,id:before?.id ?? fields.id,localDate:date,week:mondayOf(date)};
  insist(!before || (action === 'coverage' ? after.instructorId !== before.instructorId : after.start !== before.start || after.end !== before.end),'recommendation_has_no_change');
  if (action === 'coverage') insist(qualifiedForService(tx.state,after.instructorId,after.service),'substitution_qualification_required',409);
  const evidence = demandEvidence(tx.state,sources);
  insist(evidence.some(c => c.service === after.service),'matching_service_source_required');
  checkAllocations(tx,[after],before ? [before.id] : []);
  const impact = before ? {...changeImpact(tx.state,[before],[after]),key:id()} : {classes:[],bookings:0,members:0,notices:0,emails:0,creditsChanged:0,moneyMoved:0,key:id()};
  for (const c of impact.classes) for (const b of c.bookings) b.body += ` Reason: ${reason}.`;
  const recommendation = {action,reason,evidence,availability:demandAvailability(tx.state),
    instructors:availableInstructors(tx.state,after,before ? [before.id] : []),
    notification:impact.bookings ? 'in-app-and-email' : 'no-affected-reservations',
    email:context.mailConfigured ? 'configured; provider outcome recorded after approval' : mailNotConfigured};
  const draft = {id:id(),type:'classes',status:'draft',week:after.week,classes:[after],before,impact,recommendation,
    demandBasis:await demandBasis(tx.state),mailBasis:mailBasis(context),createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}

export async function approveRecommendation(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.recommendation,'recommendation_required');
  insist(input.impact === draft.impact.key && input.notification === draft.recommendation.notification,'recommendation_preview_changed',409);
  if (draft.status === 'approved') return {id:draft.id,status:'approved',classes:draft.classes};
  insist(draft.demandBasis === await demandBasis(tx.state) && draft.mailBasis === mailBasis(context),'recommendation_facts_changed',409);
  checkAllocations(tx,draft.classes,draft.before ? [draft.before.id] : []);
  if (draft.before) changeImpact(tx.state,[draft.before],draft.classes);
  approveDraft(tx,draft);
  const at = now();
  for (const entry of draft.classes) {
    const provenance = {id:draft.id,originalInstructorId:draft.before?.instructorId,instructorId:entry.instructorId,approvedAt:at,approvedBy:tx.who.id,source:'demand-recommendation'};
    tx.put('class',{...entry,status:'published',recommendationId:draft.id,...(draft.before ? {updatedAt:at,updatedBy:tx.who.id} : {draftId:draft.id,publishedAt:at}),
      ...(draft.recommendation.action === 'coverage' ? {substitution:provenance,substitutionHistory:[...(entry.substitutionHistory ?? []),provenance]} : {})});
  }
  if (draft.before) applyChangeNotices(tx,draft,context);
  return {id:draft.id,status:'approved',classes:draft.classes};
}

export async function recommendationStale(state: State, draft: RecordData) {
  return !!draft.recommendation && draft.status === 'draft' && draft.demandBasis !== await demandBasis(state);
}

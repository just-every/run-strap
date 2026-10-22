import { humanOwner, preparer, id, instant, integer, insist, list, now, person, record, text, type RecordData } from './types';
import type { Transaction } from './store';
import { approveDraft } from './drafts';
import { refuseSchedulingConflicts, schedulingConflicts, schedulingFields } from './scheduling';
import { refuseLocationClosures } from './closures';
import { locationById, ORIGINAL_LOCATION } from './locations';
import { studioSettings } from './studio';
import type { State } from './types';

// Adapted from Dial availability/windows.ts -> weekdayForDate in timezone.ts.
// Source: dial/src/core/features/availability/{windows,timezone}.ts
// Commit: 66d22da8d5c4d7fe2c368ae8d21a2615875abfe4.
function weekdayForDate(hostDate: string) {
  const [year, month, day] = hostDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function weekStart(value: unknown) {
  const day = text(value,'week',10);
  insist(/^\d{4}-\d\d-\d\d$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day && weekdayForDate(day) === 1,'week_must_be_monday');
  return day;
}
export function checkAllocations(tx: Transaction, classes: RecordData[], excluded: string[] = []) {
  const published = list(tx.state,'class').filter(c => c.status !== 'cancelled' && !excluded.includes(c.id));
  for (const item of classes) {
    const instructor = person(tx.state,item.instructorId);
    insist(instructor.role === 'instructor','instructor_required');
    insist(instructor.version === item.instructorVersion,'instructor_changed',409);
    insist(item.start > now() && item.end > item.start,'class_must_be_future');
    tx.future(item.start);
  }
  refuseSchedulingConflicts(schedulingConflicts(classes,published,list(tx.state,'unavailability')),tx.who.role === 'owner');
  refuseLocationClosures(tx.state,classes);
}
function checkClasses(tx: Transaction, classes: RecordData[], week: string) {
  const weekEnd = new Date(Date.parse(week)+7*86_400_000).toISOString().slice(0,10);
  for (const item of classes) insist(item.localDate >= week && item.localDate < weekEnd,'class_outside_week');
  checkAllocations(tx,classes);
}
/** Shared class normalization for week and recurring timetable doors. */
/** STUDIO-002: a class belongs to one location and is entered and shown on that location's clock. */
function placement(state: State, entry: Record<string,unknown>) {
  const key = entry.locationId ?? ORIGINAL_LOCATION;
  if (key === ORIGINAL_LOCATION && !studioSettings(state)) return {};
  const place = locationById(state,key);
  return {locationId:place.id,location:place.name,timeZone:place.timeZone};
}
export function classFields(tx: Transaction, entry: Record<string,unknown>): RecordData {
  const instructor = person(tx.state,entry.instructorId);
  return {id:id(),title:text(entry.title,'title',160),service:text(entry.service || entry.title,'service',160),start:instant(entry.start,'start'),end:instant(entry.end,'end'),localDate:String(entry.start).slice(0,10),capacity:integer(entry.capacity,'capacity',1,1000),onlineCapacity:integer(entry.onlineCapacity ?? entry.capacity,'online_capacity',0,integer(entry.capacity,'capacity',1,1000)),instructorId:instructor.id,instructorName:instructor.name,instructorVersion:instructor.version,...placement(tx.state,entry),...schedulingFields(entry)};
}

export function prepareClasses(tx: Transaction, input: Record<string, unknown>) {
  preparer(tx.who);
  const week = weekStart(input.week);
  insist(Array.isArray(input.classes) && input.classes.length > 0 && input.classes.length <= 100,'classes_required');
  const classes = input.classes.map((raw: unknown): RecordData => {
    insist(raw && typeof raw === 'object','invalid_class');
    return classFields(tx,raw as Record<string,unknown>);
  });
  checkClasses(tx,classes,week);
  const draft = {id:id(),type:'classes',status:'draft',week,classes,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export function publishClasses(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.type === 'classes' && !draft.recommendation,'wrong_draft_type');
  checkClasses(tx,draft.classes,draft.week);
  approveDraft(tx,draft);
  const published = draft.classes.map((entry: RecordData) => ({...entry,week:draft.week,status:'published',draftId:draft.id,publishedAt:now()}));
  for (const item of published) tx.put('class',item);
  return {id:draft.id,status:'approved',classes:published};
}

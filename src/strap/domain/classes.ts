import { humanOwner, preparer, id, instant, integer, insist, list, now, person, record, text, type RecordData } from './types';
import type { Transaction } from './store';
import { approveDraft } from './drafts';
import { refuseSchedulingConflicts, schedulingConflicts, schedulingFields } from './scheduling';

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
function checkClasses(tx: Transaction, classes: RecordData[], week: string) {
  const published = list(tx.state,'class');
  const weekEnd = new Date(Date.parse(week)+7*86_400_000).toISOString().slice(0,10);
  for (const item of classes) {
    const instructor = person(tx.state,item.instructorId);
    insist(instructor.role === 'instructor','instructor_required');
    insist(instructor.version === item.instructorVersion,'instructor_changed',409);
    insist(item.start > now() && item.end > item.start,'class_must_be_future');
    tx.future(item.start);
    // Compare the supplied civil date, retained with the frozen draft, so offsets
    // do not move an evening class into a different timetable week.
    insist(item.localDate >= week && item.localDate < weekEnd,'class_outside_week');
  }
  refuseSchedulingConflicts(schedulingConflicts(classes,published,list(tx.state,'unavailability')), tx.who.role === 'owner');
}
export function prepareClasses(tx: Transaction, input: Record<string, unknown>) {
  preparer(tx.who);
  const week = weekStart(input.week);
  insist(Array.isArray(input.classes) && input.classes.length > 0 && input.classes.length <= 100,'classes_required');
  const classes = input.classes.map((raw: unknown): RecordData => {
    insist(raw && typeof raw === 'object','invalid_class');
    const entry = raw as Record<string,unknown>, instructor = person(tx.state,entry.instructorId);
    return {id:id(),title:text(entry.title,'title',160),service:text(entry.service || entry.title,'service',160),start:instant(entry.start,'start'),end:instant(entry.end,'end'),localDate:String(entry.start).slice(0,10),capacity:integer(entry.capacity,'capacity',1,1000),onlineCapacity:integer(entry.onlineCapacity ?? entry.capacity,'online_capacity',0,integer(entry.capacity,'capacity',1,1000)),instructorId:instructor.id,instructorName:instructor.name,instructorVersion:instructor.version,...schedulingFields(entry)};
  });
  checkClasses(tx,classes,week);
  const draft = {id:id(),type:'classes',status:'draft',week,classes,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export function publishClasses(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.type === 'classes','wrong_draft_type');
  checkClasses(tx,draft.classes,draft.week);
  approveDraft(tx,draft);
  const published = draft.classes.map((entry: RecordData) => ({...entry,week:draft.week,status:'published',draftId:draft.id,publishedAt:now()}));
  for (const item of published) tx.put('class',item);
  return {id:draft.id,status:'approved',classes:published};
}

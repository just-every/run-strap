import { addDays, localDate } from '../zone';
import { humanOwner, id, insist, integer, now, preparer, record, text, type RecordData } from './types';
import type { Transaction } from './store';
import { approveDraft } from './drafts';
import { checkAllocations, classFields } from './classes';
import { classWeek, civilDate, mailBasis, recurrence, seriesBasis, seriesSelection, wallStart } from './series-model';
import { applyChangeNotices, changeImpact } from './series-effects';
import { mailNotConfigured, type NoticeContext } from './notices';

export async function prepareSeries(tx: Transaction, input: Record<string,unknown>) {
  preparer(tx.who);
  const rule = recurrence(tx.state,input), seriesId = id();
  const classes = rule.dates.map((date,seriesIndex) => {
    const start = wallStart(date,rule.time,rule.timeZone);
    return {...classFields(tx,{...input,start,end:new Date(Date.parse(start)+rule.minutes*60_000).toISOString()}),seriesId,seriesIndex,occurrenceDate:date,localDate:date,week:classWeek(date),location:rule.location,timeZone:rule.timeZone};
  });
  checkAllocations(tx,classes);
  const draft = {id:id(),type:'series',status:'draft',seriesId,rule,classes,basis:(await seriesBasis(tx.state)),createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export async function publishSeries(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft'); insist(draft.type === 'series','wrong_draft_type');
  checkAllocations(tx,draft.classes);
  insist(draft.basis === (await seriesBasis(tx.state)),'series_facts_changed',409);
  approveDraft(tx,draft);
  const at = now(), series = {id:draft.seriesId,...draft.rule,classIds:draft.classes.map((c: RecordData) => c.id),draftId:draft.id,publishedAt:at,publishedBy:tx.who.id,status:'published'};
  tx.put('series',series);
  const classes = draft.classes.map((c: RecordData) => ({...c,status:'published',draftId:draft.id,publishedAt:at}));
  for (const c of classes) tx.put('class',c);
  return {series,classes};
}
export async function prepareSeriesChange(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  preparer(tx.who);
  const selection = seriesSelection(tx.state,input), {series,selected,scope} = selection;
  const change = input.change as Record<string,unknown>;
  insist(change && typeof change === 'object' && !Array.isArray(change),'invalid_series_change');
  const firstDate = localDate(selected.start,series.timeZone), date = change.startDate === undefined ? firstDate : civilDate(change.startDate);
  const delta = Math.round((Date.parse(date)-Date.parse(firstDate))/86_400_000);
  const classes = selection.classes.map(c => {
    const local = localDate(c.start,series.timeZone), newDate = addDays(local,delta);
    const time = change.time ?? new Intl.DateTimeFormat('en-GB',{timeZone:series.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(c.start));
    const start = wallStart(newDate,time,series.timeZone), minutes = integer(change.minutes ?? (Date.parse(c.end)-Date.parse(c.start))/60_000,'minutes',5,600);
    const fields = classFields(tx,{...c,...change,start,end:new Date(Date.parse(start)+minutes*60_000).toISOString()});
    return {...c,...fields,id:c.id,localDate:newDate,week:classWeek(newDate)};
  });
  checkAllocations(tx,classes,classes.map(c => c.id));
  const reason = text(input.reason,'reason',300);
  const impact = {...changeImpact(tx.state,selection.classes,classes),key:id()};
  for (const c of impact.classes) for (const b of c.bookings) b.body += ` Reason: ${reason}.`;
  const draft = {id:id(),type:'series-change',status:'draft',seriesId:series.id,classId:selected.id,scope,reason,classes,impact,basis:(await seriesBasis(tx.state)),mailBasis:mailBasis(context),email:context.mailConfigured ? 'configured' : mailNotConfigured,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export async function approveSeriesChange(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft'); insist(draft.type === 'series-change','wrong_draft_type');
  if (draft.status === 'approved') return {id:draft.id,status:'approved'};
  checkAllocations(tx,draft.classes,draft.classes.map((c: RecordData) => c.id));
  insist(input.impact === draft.impact.key && draft.basis === (await seriesBasis(tx.state)) && draft.mailBasis === mailBasis(context),'series_impact_changed',409);
  // Validate reservations once more under the same revision fence used at commit.
  changeImpact(tx.state,draft.impact.classes.map((c: RecordData) => c.before),draft.classes);
  approveDraft(tx,draft);
  for (const c of draft.classes) tx.put('class',{...c,seriesChangeId:draft.id,updatedAt:now(),updatedBy:tx.who.id});
  applyChangeNotices(tx,draft,context);
  return {id:draft.id,status:'approved',classes:draft.classes};
}

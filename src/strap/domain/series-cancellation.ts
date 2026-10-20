import { humanOwner, id, insist, list, now, record, text } from './types';
import type { Transaction } from './store';
import { confirmClosure, prepareClosure, prepareSelectedClosure } from './closures';
import { mailBasis, seriesBasis, seriesSelection } from './series-model';
import { mailNotConfigured, type NoticeContext } from './notices';

/** Compose the established closure transaction for precisely the reviewed
 * occurrences. One closure identity groups selected occurrences into one email per member. */
export async function prepareSeriesCancellation(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const {series,selected,scope,classes} = seriesSelection(tx.state,input,true);
  const reason = text(input.reason,'reason',300);
  const closure = await prepareSelectedClosure(tx,{seriesId:series.id,classIds:classes.map(c => c.id),seriesScope:scope},reason,context);
  const impact = {...closure.impact,key:id(),notices:closure.impact.classes.flatMap(c => c.bookings).length,emails:closure.impact.members};
  const draft = {id:id(),seriesId:series.id,classId:selected.id,scope,status:'draft',reason,impact,closureId:closure.id,basis:(await seriesBasis(tx.state)),mailBasis:mailBasis(context),email:context.mailConfigured ? 'configured' : mailNotConfigured,createdAt:now(),createdBy:tx.who.id};
  tx.put('seriesCancellation',draft); return draft;
}
export async function confirmSeriesCancellation(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'seriesCancellation');
  if (draft.status === 'applied') return draft;
  insist(draft.status === 'draft','closure_not_draft',409);
  insist(input.impact === draft.impact.key && draft.basis === (await seriesBasis(tx.state)) && draft.mailBasis === mailBasis(context),'series_impact_changed',409);
  const closure = record(tx.state,draft.closureId,'closure');
  await confirmClosure(tx,{id:closure.id,impact:closure.impact.key},context);
  const applied = {...draft,status:'applied',closureIds:[closure.id],appliedAt:now(),appliedBy:tx.who.id};
  tx.put('seriesCancellation',applied); return applied;
}
/** Existing class cancellation doors require a deliberate series scope too. */
export function prepareScopedClosure(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  if (input.scope === 'class' && tx.state.records.get(String(input.classId))?.data.seriesId) {
    humanOwner(tx.who);
    insist(input.seriesScope,'series_scope_required');
    return prepareSeriesCancellation(tx,{...input,scope:input.seriesScope},context);
  }
  return prepareClosure(tx,input,context);
}

/** Preserve the existing prepare/confirm closure door for a scoped series too. */
export function confirmScopedClosure(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const source = tx.state.records.get(String(input.id));
  if (source?.kind === 'seriesCancellation') return confirmSeriesCancellation(tx,input,context);
  if (source?.kind === 'closure' && source.data.scope === 'series') {
    insist(input.impact === source.data.impact.key,'closure_impact_changed',409);
    const draft = list(tx.state,'seriesCancellation').find(c => c.closureId === source.data.id);
    insist(draft,'series_cancellation_not_found',404);
    return confirmSeriesCancellation(tx,{id:draft.id,impact:draft.impact.key},context);
  }
  return confirmClosure(tx,input,context);
}

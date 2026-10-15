import { humanOwner, id, insist, now, type RecordData } from './types';
import type { Transaction } from './store';

// Adapted from Nectar's prepareChange/approveChange revision + draft-status
// fence, src/nectar/subscriptions.ts, 7f38865a4d41e13e24c1cb16a07ae489c9184cea.
// Draft payloads are immutable; only approval metadata changes. The shared
// st_meta compare-and-abort fence protects the observed draft and its basis.
export function approveDraft(tx: Transaction, draft: RecordData) {
  humanOwner(tx.who);
  insist(draft.status === 'draft','already_decided',409);
  const approvedAt = now();
  tx.put('draft',{...draft,status:'approved',approvedBy:tx.who.id,approvedAt});
  tx.put('approval',{id:id(),draftId:draft.id,type:draft.type,approvedBy:tx.who.id,approvedAt});
}

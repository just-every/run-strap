import { humanOwner, preparer, id, instant, integer, insist, list, now, person, record, text, type State } from './types';
import type { Transaction } from './store';
import { approveDraft } from './drafts';
import { promoteAll } from './bookings';

export function balance(state: State, personId: string) {
  return list(state,'charge').filter(r => r.personId === personId).reduce((sum,r) => sum+r.amountCents,0)
    - list(state,'payment').filter(r => r.personId === personId).reduce((sum,r) => sum+r.amountCents,0);
}
export function preparePack(tx: Transaction, input: Record<string,unknown>) {
  preparer(tx.who);
  const member = person(tx.state,input.personId), expiresAt = instant(input.expiresAt,'expiresAt');
  insist(expiresAt > now(),'expiry_must_be_future');
  tx.future(expiresAt);
  const draft = {id:id(),type:'pack',status:'draft',personId:member.id,personVersion:member.version,credits:integer(input.credits,'credits',1,10_000),amountCents:integer(input.amountCents,'amountCents',0,100_000_000),expiresAt,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export function approvePack(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.type === 'pack','wrong_draft_type');
  const member = person(tx.state,draft.personId);
  insist(member.version === draft.personVersion,'person_changed',409);
  insist(draft.expiresAt > now(),'expiry_must_be_future');
  tx.future(draft.expiresAt);
  approveDraft(tx,draft);
  const pack = {id:id(),personId:member.id,credits:draft.credits,remaining:draft.credits,amountCents:draft.amountCents,expiresAt:draft.expiresAt,draftId:draft.id,createdAt:now()};
  tx.put('pack',pack);
  tx.put('charge',{id:id(),personId:member.id,packId:pack.id,amountCents:draft.amountCents,createdAt:now()});
  promoteAll(tx);
  return {id:pack.id,draftId:draft.id,status:'approved'};
}
export function recordPayment(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId,false), reference = text(input.reference,'reference',160);
  insist(!list(tx.state,'payment').some(p => p.reference === reference),'payment_reference_used',409);
  const payment = {id:id(),personId:member.id,amountCents:integer(input.amountCents,'amountCents',1,100_000_000),reference,createdAt:now(),recordedBy:tx.who.id};
  tx.put('payment',payment); return payment;
}
// Adapted Nectar src/nectar/collections.ts reminderBasis/basisKey and
// approveReminder, 7f38865a4d41e13e24c1cb16a07ae489c9184cea. The exact facts
// (not only the sum) must still hold; approval exports text and sends no mail.
function reminderBasis(state: State, personId: string) {
  const member = person(state,personId,false);
  return JSON.stringify({personVersion:member.version,email:member.email,name:member.name,
    charges:list(state,'charge').filter(r => r.personId === personId).map(r => [r.id,r.amountCents]),
    payments:list(state,'payment').filter(r => r.personId === personId).map(r => [r.id,r.amountCents,r.reference])});
}
export function prepareReminder(tx: Transaction, input: Record<string,unknown>) {
  preparer(tx.who);
  const member = person(tx.state,input.personId,false), balanceCents = balance(tx.state,member.id);
  insist(balanceCents > 0,'nothing_owed',409);
  const amount = (balanceCents/100).toFixed(2);
  const draft = {id:id(),type:'reminder',status:'draft',personId:member.id,balanceCents,basis:reminderBasis(tx.state,member.id),recipient:member.email,subject:`Studio balance reminder: $${amount}`,body:`Hello ${member.name},\n\nOur records show a studio balance of $${amount}. If you have already paid, please reply with your payment reference so we can match it.\n\nThank you.`,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export function approveReminder(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.type === 'reminder','wrong_draft_type');
  insist(draft.basis === reminderBasis(tx.state,draft.personId),'balances_changed',409);
  approveDraft(tx,draft);
  return {id:draft.id,status:'approved',text:`To: ${draft.recipient}\nSubject: ${draft.subject}\n\n${draft.body}\n`};
}

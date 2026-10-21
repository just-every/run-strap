import { humanOwner, id, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent } from './pack-credits';
import { putNotice, reserveMail } from './notices';
import { localDate, offsetMinutes } from '../zone';
import { studioSettings } from './studio';

/** Native invoice agreement: consent to studio debt, never authority to debit a payment method. */
export const recurringForPack = (state: State, packId: string) => list(state,'recurringTerms').find(r => r.status === 'active' && r.currentPackId === packId) ?? null;
export const recurringBasis = (state: State, packId: string) => recurringForPack(state,packId);
const packTerms = (pack: RecordData) => ({credits:pack.credits,amountCents:pack.amountCents,entitlement:pack.entitlement ?? null,eligibleServices:pack.eligibleServices ?? [],priorityBooking:pack.priorityBooking === true,guestTerms:pack.guestTerms ?? null});
const proposalBasis = (state: State, pack: RecordData) => JSON.stringify({pack,member:person(state,pack.personId,false),recurring:recurringForPack(state,pack.id),changes:list(state,'planChange').filter(c => c.packId === pack.id && c.status === 'accepted'),freezes:list(state,'freeze').filter(f => f.packId === pack.id && ['scheduled','active'].includes(f.status))});
export function contractNotice(tx: Transaction, source: string, personId: string, subject: string, body: string, bookingIds: string[] = []) {
  putNotice(tx,{id:`notice:${source}`,personId,subject,body},true);
  return reserveMail(tx,tx.notices,{id:`mail:${source}`,sourceKind:'booking_action',sourceId:source,personId,subject,body,bookingIds,prepared:true});
}
const zone = (state: State) => studioSettings(state)?.timeZone ?? 'UTC';
const dayIn = (at: string, timeZone: string) => Number(localDate(at,timeZone).slice(-2));
/** Calendar months on the agreed studio clock; short months use their last day. */
function nextInvoiceAt(at: string, months: number, day: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(at)).map(p => [p.type,Number(p.value)]));
  const month = new Date(Date.UTC(p.year,p.month-1+months,1));
  const last = new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
  const wall = Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),Math.min(day,last),p.hour,p.minute,p.second);
  let offset = offsetMinutes(new Date(wall),timeZone);
  offset = offsetMinutes(new Date(wall-offset*60_000),timeZone);
  return new Date(wall-offset*60_000).toISOString();
}
export async function prepareRecurringTerms(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const pack = record(tx.state,input.packId,'pack'); person(tx.state,pack.personId);
  insist(pack.expiresAt > now(),'pack_expired',409);
  insist(!recurringForPack(tx.state,pack.id),'recurring_terms_exist',409);
  insist(!list(tx.state,'planChange').some(c => c.packId === pack.id && c.status === 'accepted'),'plan_change_pending',409);
  insist(!list(tx.state,'freeze').some(f => f.packId === pack.id && ['scheduled','active'].includes(f.status)),'freeze_pending',409);
  const intervalMonths = integer(input.intervalMonths,'intervalMonths',1,12), timeZone = zone(tx.state);
  const origin = text(tx.notices.origin,'billing_origin',2000);
  const connected = await tx.db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>();
  insist(!connected || connected.origin === origin,'billing_origin_changed',409);
  const connectionId = connected?.connection_id ?? id();
  if (!connected) tx.sql.push(tx.statement("INSERT INTO st_contract_connections(id,connection_id,origin,approved_by,approved_at) VALUES('billing',?,?,?,?)",connectionId,origin,tx.who.id,now()));
  const proposal = {id:id(),personId:pack.personId,packId:pack.id,status:'preview',intervalMonths,timeZone,connectionId,...packTerms(pack),nextRenewalAt:pack.expiresAt,
    billingDay:dayIn(pack.expiresAt,timeZone),basis:proposalBasis(tx.state,pack),createdAt:now(),createdBy:tx.who.id,
    consent:'Automatically create a studio invoice and new term every agreed cycle. The invoice is added to my studio balance. Strap will not debit a card or bank account.'};
  const terms = {...proposal,key:JSON.stringify(proposal)};
  tx.put('recurringTerms',terms); return terms;
}
export async function acceptRecurringTerms(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_acceptance_required',403);
  const terms = record(tx.state,input.id,'recurringTerms');
  insist(terms.personId === tx.who.personId,'recurringTerms_not_found',404);
  insist(input.key === terms.key,'preview_changed',409);
  if (terms.acceptedBy) { insist(terms.acceptedBy === tx.who.id,'recurring_terms_closed',409); return terms; }
  insist(terms.status === 'preview' && now() < terms.nextRenewalAt,'preview_expired',409);
  const connection = await tx.db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>();
  insist(connection && connection.connection_id === terms.connectionId && connection.origin === tx.notices.origin,'billing_reconnection_required',409);
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_contract_connections WHERE id='billing' AND connection_id=? AND origin=?) THEN 1 ELSE 0 END",terms.connectionId,tx.notices.origin));
  const pack = record(tx.state,terms.packId,'pack');
  insist(terms.basis === proposalBasis(tx.state,pack),'plan_changed',409); tx.future(terms.nextRenewalAt);
  const accepted = {...terms,status:'active',currentPackId:pack.id,billingOrigin:tx.notices.origin ?? null,acceptedAt:now(),acceptedBy:tx.who.id};
  tx.put('recurringTerms',accepted);
  contractNotice(tx,`recurring-consent:${terms.id}`,pack.personId,'Recurring invoices agreed',`${terms.consent} Every ${terms.intervalMonths} calendar month(s), $${(terms.amountCents/100).toFixed(2)}; first renewal ${terms.nextRenewalAt} (${terms.timeZone}).`);
  return accepted;
}
/** Freeze and early-end use this in their own atomic command; no invoice is generated here. */
export function moveRecurringRenewal(tx: Transaction, packId: string, expiresAt: string, freezeId: string) {
  const terms = recurringForPack(tx.state,packId); if (!terms) return;
  tx.put('recurringTerms',{...terms,nextRenewalAt:expiresAt,billingDay:dayIn(expiresAt,terms.timeZone),renewalMovedByFreezeId:freezeId});
}
/** One transaction writes invoice, real balance charge, new entitlement and next due identity. */
export async function applyDueRecurringInvoices(tx: Transaction) {
  const at = now(), connection = await tx.db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>();
  for (const initial of list(tx.state,'recurringTerms').filter(r => r.status === 'active')) {
    let terms = initial;
    // The live installation epoch is excluded from native archives. Restored
    // agreements cannot charge, even when restored at the same origin.
    if (!connection || connection.connection_id !== terms.connectionId || connection.origin !== tx.notices.origin || terms.billingOrigin !== tx.notices.origin) {
      tx.put('recurringTerms',{...terms,status:'needs_reconnection',failure:'billing_reconnection_required'}); continue;
    }
    tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_contract_connections WHERE id='billing' AND connection_id=? AND origin=?) THEN 1 ELSE 0 END",terms.connectionId,tx.notices.origin));
    // Bounded catch-up never drops a period: the next sweep continues at the retained next date.
    for (let count = 0; terms.nextRenewalAt <= at && count < 24; count++) {
      if (list(tx.state,'freeze').some(f => f.packId === terms.currentPackId && ['scheduled','active'].includes(f.status) && f.startAt <= terms.nextRenewalAt && (!f.endAt || f.endAt > terms.nextRenewalAt))) break;
      const pack = record(tx.state,terms.currentPackId,'pack'), member = tx.state.people.find(p => p.id === terms.personId);
      if (!member?.active || member.erasedAt || pack.expiresAt !== terms.nextRenewalAt || JSON.stringify(packTerms(pack)) !== JSON.stringify({credits:terms.credits,amountCents:terms.amountCents,entitlement:terms.entitlement,eligibleServices:terms.eligibleServices,priorityBooking:terms.priorityBooking,guestTerms:terms.guestTerms})) {
        tx.put('recurringTerms',{...terms,status:'needs_review',failure:'source_terms_changed',failedAt:at}); break;
      }
      const due = terms.nextRenewalAt, invoiceId = `invoice:${terms.id}:${due}`;
      insist(!tx.state.records.has(invoiceId),'recurring_invoice_already_exists',409);
      const expiresAt = nextInvoiceAt(due,terms.intervalMonths,terms.billingDay,terms.timeZone);
      insist(expiresAt > due,'invalid_billing_cycle',409); tx.reached(due);
      const next = {id:id(),personId:pack.personId,...packTerms(pack),creditLedgerVersion:1,creditRevision:0,remaining:0,
        termStartAt:due,expiresAt,recurringTermsId:terms.id,renewedFromPackId:pack.id,invoiceId,createdAt:at};
      tx.put('pack',next); appendPackEvent(tx,next,{type:'grant',credits:terms.credits});
      const chargeId = `charge:${invoiceId}`;
      tx.put('charge',{id:chargeId,personId:pack.personId,packId:next.id,invoiceId,recurringTermsId:terms.id,kind:'recurring-invoice',amountCents:terms.amountCents,createdAt:at});
      const invoice = {id:invoiceId,personId:pack.personId,packId:next.id,previousPackId:pack.id,recurringTermsId:terms.id,dueAt:due,termEndAt:expiresAt,
        amountCents:terms.amountCents,chargeId,status:'open',collection:'studio-balance-only',createdAt:at};
      tx.put('recurringInvoice',invoice);
      contractNotice(tx,invoiceId,pack.personId,'Renewal invoice issued',`Invoice for ${due} to ${expiresAt}: $${(terms.amountCents/100).toFixed(2)} added to your studio balance. No payment has been collected.`);
      terms = {...terms,currentPackId:next.id,nextRenewalAt:expiresAt,lastInvoiceId:invoiceId}; tx.put('recurringTerms',terms);
    }
  }
}
export function recurringSnapshot(state: State, who: Actor) {
  const visible = (r: RecordData) => who.role === 'owner' || (who.role === 'member' && r.personId === who.personId);
  return {terms:list(state,'recurringTerms').filter(visible).map(r => ({...r,stale:r.status === 'preview' && (r.nextRenewalAt <= now() || !state.records.has(r.packId) || r.basis !== proposalBasis(state,record(state,r.packId,'pack')))})),invoices:list(state,'recurringInvoice').filter(visible)};
}

/** Withdraw future invoice authority without erasing already agreed/due debt. */
export function stopRecurringTerms(tx: Transaction, input: Record<string,unknown>) {
  const terms = record(tx.state,input.id,'recurringTerms');
  insist(tx.who.role === 'owner' && tx.who.isOwner || tx.who.role === 'member' && terms.personId === tx.who.personId,'recurringTerms_not_found',404);
  const reason = text(input.reason,'reason',500), requestId = text(input.requestId,'requestId',100);
  if (terms.status === 'stopped') { insist(terms.stoppedBy === tx.who.id && terms.stopRequestId === requestId && terms.stopReason === reason,'recurring_terms_stopped',409); return terms; }
  insist(['active','needs_review','needs_reconnection','preview'].includes(terms.status),'recurring_terms_closed',409);
  const stopped = {...terms,status:'stopped',stoppedAt:now(),stoppedBy:tx.who.id,stopRequestId:requestId,stopReason:reason};
  tx.put('recurringTerms',stopped);
  contractNotice(tx,`recurring-stop:${terms.id}`,terms.personId,'Future renewal invoices stopped','Your invoice agreement has stopped. No later renewal invoice or new term will be created. Invoices already due and previously recorded charges remain; no payment or refund was made.');
  return stopped;
}

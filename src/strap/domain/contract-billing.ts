import { requireStaffRight } from './staff-rights';
import { signingMissing } from './bookings';
import { intakeMissing } from './intake';
import { humanOwner, id, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent } from './pack-credits';
import { putNotice, reserveMail } from './notices';
import { localDate, offsetMinutes } from '../zone';
import { studioSettings } from './studio';
import { staffChannel } from './staff-actions';
import { acceptedSaleContext, previewSaleContext, proposalSaleContext, saleContextCurrent } from './contract-sale-context';

/** Native invoice agreement: consent to studio debt, never authority to debit a payment method. */
export const recurringForPack = (state: State, packId: string) => list(state,'recurringTerms').find(r => r.status === 'active' && r.currentPackId === packId) ?? null;
export const recurringBasis = (state: State, packId: string) => recurringForPack(state,packId);
const packTerms = (pack: RecordData) => ({credits:pack.credits,amountCents:pack.amountCents,entitlement:pack.entitlement ?? null,eligibleServices:pack.eligibleServices ?? [],priorityBooking:pack.priorityBooking === true,guestTerms:pack.guestTerms ?? null});
const proposalBasis = (state: State, pack: RecordData) => JSON.stringify({pack,member:person(state,pack.personId,false),recurring:recurringForPack(state,pack.id),changes:list(state,'planChange').filter(c => c.packId === pack.id && c.status === 'accepted'),freezes:list(state,'freeze').filter(f => f.packId === pack.id && ['scheduled','active'].includes(f.status))});
export function contractNotice(tx: Transaction, source: string, personId: string, subject: string, body: string, bookingIds: string[] = [], requiredEmail = false) {
  putNotice(tx,{id:`notice:${source}`,personId,subject,body},true);
  return reserveMail(tx,tx.notices,{id:`mail:${source}`,sourceKind:'booking_action',sourceId:source,personId,subject,body,bookingIds,prepared:true,...(requiredEmail ? {category:'required_contract' as const} : {})});
}
export type BillingConnection = {connection_id:string;origin:string};
const connectionSQL = "SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'";
const fenceConnection = (tx: Transaction, connection: BillingConnection) => tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_contract_connections WHERE id='billing' AND connection_id=? AND origin=?) THEN 1 ELSE 0 END",connection.connection_id,connection.origin));
const stopPathFor = (termsId: string) => `/app/packs#recurring-${encodeURIComponent(termsId)}`;
const debtOnly = 'This authorizes studio-balance debt only. No card or bank payment is authorized or collected.';
const consentText = (r: RecordData) => `Price changes require at least ${r.noticeLeadDays} elapsed days of notice and my personal acceptance before the exact effective renewal date stated in the notice. If I do not accept by then, my original price continues. Renewal and price notices always go by email, regardless of booking email preferences. I agree to a studio invoice of $${(r.amountCents/100).toFixed(2)} every ${r.intervalMonths} calendar month(s), first due ${r.firstDueAt} (${r.timeZone}), continuing until stopped. Stop future invoices in one step: ${r.stopPath}. Stopping is effective immediately and access continues to the current term end. ${debtOnly}`
  + (r.originalInitiationFeeCents > 0 ? ` The $${(r.originalInitiationFeeCents/100).toFixed(2)} one-time initiation fee was included in the original sale. Each recurring invoice is $${(r.amountCents/100).toFixed(2)}; the initiation fee does not repeat.` : '');
// The ct ruling supplies this policy; no consent evidence is automatically purged.
const consentRetention = (acceptedAt: string, endedAt: string | null = null) => ({
  policy:'BILL-005',source:'ct ruling 22 Oct 2026',minimumYearsFromAcceptance:3,minimumYearsAfterEnd:1,
  retainUntilAtLeast:new Date(Math.max(Date.parse(nextInvoiceAt(acceptedAt,36,dayIn(acceptedAt,'UTC'),'UTC')),endedAt ? Date.parse(nextInvoiceAt(endedAt,12,dayIn(endedAt,'UTC'),'UTC')) : 0)).toISOString(),
  agreementEndPending:!endedAt,restrictedAfterErasure:true,archive:true,portableExit:true,
});
const zone = (state: State) => studioSettings(state)?.timeZone ?? 'UTC';
const dayIn = (at: string, timeZone: string) => Number(localDate(at,timeZone).slice(-2));
/** Calendar months on the agreed studio clock; short months use their last day. */
function nextInvoiceAt(at: string, months: number, day: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(at)).map(p => [p.type,Number(p.value)]));
  const month = new Date(Date.UTC(p.year,p.month-1+months,1));
  const last = new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
  const wall = Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),Math.min(day,last),p.hour,p.minute,p.second,new Date(at).getUTCMilliseconds());
  let offset = offsetMinutes(new Date(wall),timeZone);
  offset = offsetMinutes(new Date(wall-offset*60_000),timeZone);
  return new Date(wall-offset*60_000).toISOString();
}
export async function prepareRecurringTerms(tx: Transaction, input: Record<string,unknown>) {
  requireStaffRight(tx.state,tx.who,'membership-sale');
  text(input.requestId,'requestId',100);
  const pack = record(tx.state,input.packId,'pack');
  requireStaffRight(tx.state,tx.who,'membership-sale',pack.personId,pack.locationId ?? 'studio'); person(tx.state,pack.personId);
  insist(pack.expiresAt > now(),'pack_expired',409);
  insist(!recurringForPack(tx.state,pack.id),'recurring_terms_exist',409);
  insist(!list(tx.state,'planChange').some(c => c.packId === pack.id && c.status === 'accepted'),'plan_change_pending',409);
  insist(!list(tx.state,'freeze').some(f => f.packId === pack.id && ['scheduled','active'].includes(f.status)),'freeze_pending',409);
  const intervalMonths = integer(input.intervalMonths,'intervalMonths',1,120), timeZone = zone(tx.state);
  const noticeLeadDays = integer(input.noticeLeadDays ?? 30,'noticeLeadDays',15,365);
  const saleContext = proposalSaleContext(tx.state,input);
  const origin = text(tx.notices.origin,'billing_origin',2000);
  const connected = await tx.db.prepare(connectionSQL).first<BillingConnection>();
  insist(!connected || connected.origin === origin,'billing_origin_changed',409);
  const connectionId = connected?.connection_id ?? id();
  if (!connected) tx.sql.push(tx.statement("INSERT INTO st_contract_connections(id,connection_id,origin,approved_by,approved_at) VALUES('billing',?,?,?,?)",connectionId,origin,tx.who.id,now()));
  if (connected) fenceConnection(tx,connected);
  const termsId = id();
  const proposal = {id:termsId,personId:pack.personId,packId:pack.id,status:'preview',intervalMonths,noticeLeadDays,timeZone,connectionId,...packTerms(pack),firstDueAt:pack.expiresAt,nextRenewalAt:pack.expiresAt,proposalOrigin:origin,stopPath:stopPathFor(termsId),
    billingDay:dayIn(pack.expiresAt,timeZone),basis:proposalBasis(tx.state,pack),createdAt:now(),createdBy:tx.who.id,
    collection:'studio-balance-only',continuesUntilStopped:true,originalInitiationFeeCents:pack.initiationFeeCents ?? 0,...saleContext};
  const shown = {...proposal,consent:consentText(proposal)};
  const terms = {...shown,key:JSON.stringify(shown)};
  tx.put('recurringTerms',terms); return terms;
}
export async function acceptRecurringTerms(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_acceptance_required',403);
  const terms = record(tx.state,input.id,'recurringTerms');
  insist(terms.personId === tx.who.personId,'recurringTerms_not_found',404);
  insist(input.key === terms.key,'preview_changed',409);
  const connection = await tx.db.prepare(connectionSQL).first<BillingConnection>();
  insist(connection && connection.connection_id === terms.connectionId && connection.origin === tx.notices.origin,'billing_reconnection_required',409);
  fenceConnection(tx,connection);
  if (terms.acceptedBy) { insist(terms.status === 'active' && terms.acceptedBy === tx.who.id && terms.billingOrigin === tx.notices.origin,'recurring_terms_closed',409); return terms; }
  insist(terms.status === 'preview' && now() < terms.nextRenewalAt,'preview_expired',409);
  insist(terms.proposalOrigin === tx.notices.origin && terms.consent === consentText(terms),'preview_changed',409);
  const pack = record(tx.state,terms.packId,'pack');
  insist(terms.basis === proposalBasis(tx.state,pack),'plan_changed',409); tx.future(terms.nextRenewalAt);
  const acceptedAt = now(), retention = consentRetention(acceptedAt);
  const saleContext = acceptedSaleContext(tx.state,terms,input);
  const accepted = {...terms,...saleContext,status:'active',currentPackId:pack.id,billingOrigin:tx.notices.origin,acceptedAt,acceptedBy:tx.who.id,acceptedChannel:'member-self-service',retention,
    acknowledgement:{text:terms.consent,termsKey:terms.key,actorId:tx.who.id,personId:terms.personId,at:acceptedAt,channel:'member-self-service',amountCents:terms.amountCents,intervalMonths:terms.intervalMonths,firstDueAt:terms.firstDueAt,continuesUntilStopped:true,stopPath:terms.stopPath,...saleContext}};
  tx.put('recurringTerms',accepted);
  contractNotice(tx,`recurring-consent:${terms.id}`,pack.personId,'Recurring invoices agreed',terms.consent);
  return accepted;
}
/** Freeze and early-end use this in their own atomic command; no invoice is generated here. */
export function moveRecurringRenewal(tx: Transaction, packId: string, expiresAt: string, freezeId: string) {
  const terms = recurringForPack(tx.state,packId); if (!terms) return;
  tx.put('recurringTerms',{...terms,nextRenewalAt:expiresAt,billingDay:dayIn(expiresAt,terms.timeZone),renewalMovedByFreezeId:freezeId});
}
/** Reminders are retained by event identity, with no invoice or payment effect. */
export function remindRecurringTerms(tx: Transaction, terms: RecordData, at = now()) {
  if (!terms.acceptedAt) return;
  const thisYear = Number(localDate(at,terms.timeZone).slice(0,4));
  const acceptedYear = Number(localDate(terms.acceptedAt,terms.timeZone).slice(0,4));
  let anniversary = nextInvoiceAt(terms.acceptedAt,Math.max(1,thisYear-acceptedYear)*12,dayIn(terms.acceptedAt,terms.timeZone),terms.timeZone);
  if (anniversary <= at) anniversary = nextInvoiceAt(terms.acceptedAt,Math.max(1,thisYear-acceptedYear+1)*12,dayIn(terms.acceptedAt,terms.timeZone),terms.timeZone);
  const events = [{kind:'annual',dueAt:anniversary},...(terms.intervalMonths >= 12 ? [{kind:'renewal',dueAt:terms.nextRenewalAt}] : [])];
  for (const event of events) {
    const days = (Date.parse(event.dueAt)-Date.parse(at))/86_400_000;
    const reminderId = `recurring-reminder:${terms.id}:${event.dueAt}`;
    if (days < 15 || days > 30 || tx.state.records.has(reminderId)) continue;
    const body = `${event.kind === 'renewal' ? 'Your next recurring invoice is due' : 'Your agreement anniversary is'} ${event.dueAt} (${terms.timeZone}). $${(terms.amountCents/100).toFixed(2)} every ${terms.intervalMonths} calendar month(s), until stopped. Stop immediately without a reason: ${terms.stopPath}. Access continues to the current term end. ${debtOnly} No invoice is created by this reminder.`;
    tx.reached(new Date(Date.parse(event.dueAt)-30*86_400_000).toISOString());
    tx.future(new Date(Date.parse(event.dueAt)-15*86_400_000).toISOString());
    tx.put('recurringReminder',{id:reminderId,personId:terms.personId,recurringTermsId:terms.id,kind:event.kind,kinds:events.filter(e => e.dueAt === event.dueAt).map(e => e.kind),dueAt:event.dueAt,createdAt:at,body});
    contractNotice(tx,reminderId,terms.personId,'Recurring invoice agreement reminder',body);
  }
}
export type InvoiceEligibility = {
  status: 'scheduled' | 'blocked' | 'review' | 'reconnection_required' | 'canceled';
  reason: string | null; dueAt: string; termEndAt: string; amountCents: number; priceDisclosureId: string | null;
};
/** The scheduler and forecast share source checks. Reading this projection never issues debt or notices. */
export function recurringInvoiceEligibility(state: State, terms: RecordData, connection: BillingConnection | null, origin: string, at = now()): InvoiceEligibility {
  const due = terms.nextRenewalAt, expiresAt = nextInvoiceAt(due,terms.intervalMonths,terms.billingDay,terms.timeZone);
  const result = (status: InvoiceEligibility['status'], reason: string | null = null, amountCents = terms.amountCents, priceDisclosureId: string | null = null): InvoiceEligibility =>
    ({status,reason,dueAt:due,termEndAt:expiresAt,amountCents,priceDisclosureId});
  if (terms.status === 'stopped' && terms.requiresFreshAcceptance) return result('reconnection_required','fresh_member_acceptance_required');
  if (['stopped','cancellation_scheduled'].includes(terms.status)) return result('canceled','agreement_stopped');
  if (!connection || connection.connection_id !== terms.connectionId || connection.origin !== origin || terms.billingOrigin !== origin)
    return result('reconnection_required',!connection || connection.connection_id !== terms.connectionId ? 'fresh_member_acceptance_required' : 'billing_origin_changed');
  if (terms.status !== 'active') return result(terms.status === 'needs_reconnection' ? 'reconnection_required' : 'review',terms.failure ?? 'agreement_not_active');
  if (list(state,'freeze').some(f => f.packId === terms.currentPackId && ['scheduled','active'].includes(f.status) && f.startAt <= due && (!f.endAt || f.endAt > due)))
    return result('blocked','freeze_covers_invoice_date');
  insist(expiresAt > due,'invalid_billing_cycle',409);
  if (expiresAt <= at) return result('review','billing_period_already_ended');
  const source = state.records.get(terms.currentPackId), pack = source?.kind === 'pack' ? source.data : null;
  const member = state.people.find(p => p.id === terms.personId);
  if (!member?.active || member.erasedAt || !pack || pack.expiresAt !== due || JSON.stringify(packTerms(pack)) !== JSON.stringify({credits:terms.credits,amountCents:terms.amountCents,entitlement:terms.entitlement,eligibleServices:terms.eligibleServices,priorityBooking:terms.priorityBooking,guestTerms:terms.guestTerms}))
    return result('review','source_terms_changed');
  if (signingMissing(state,terms.personId,terms.eligibleServices ?? []).length) return result('review','waiver_signature_required');
  if (intakeMissing(state,terms.personId,terms.eligibleServices ?? []).length) return result('review','intake_completion_required');
  const amendment = list(state,'renewalDisclosure').find(d => d.termsId === terms.id && d.acceptedAtPrice && !d.appliedAtPrice && d.status === 'delivered');
  if (amendment && (amendment.packId !== pack.id || amendment.dueAt !== due || amendment.currentAmountCents !== terms.amountCents || amendment.acceptedTermsKey !== terms.key || amendment.acceptanceKey !== amendment.key || !Number.isInteger(amendment.requiredNoticeDays) || amendment.requiredNoticeDays !== terms.noticeLeadDays || !amendment.deliveredAt || Date.parse(amendment.deliveredAt)+amendment.requiredNoticeDays*86400000 > Date.parse(due) || amendment.acceptByAt !== due || amendment.acceptedAtPrice >= amendment.acceptByAt || (terms.currentPriceDisclosureId ?? null) !== amendment.priorPriceDisclosureId))
    return result('review','accepted_price_source_changed');
  if (state.records.has(`invoice:${terms.id}:${due}`)) return result('review','recurring_invoice_already_exists');
  return result('scheduled',null,amendment?.proposedAmountCents ?? terms.amountCents,amendment?.id ?? null);
}
/** One sweep issues only the current due period; elapsed periods require review. */
export async function applyDueRecurringInvoices(tx: Transaction) {
  const at = now(), connection = await tx.db.prepare(connectionSQL).first<BillingConnection>();
  for (const terms of list(tx.state,'recurringTerms').filter(r => ['active','needs_review'].includes(r.status))) {
    const eligibility = recurringInvoiceEligibility(tx.state,terms,connection,tx.notices.origin ?? '',at);
    if (eligibility.status === 'reconnection_required') {
      if (terms.status === 'active') tx.put('recurringTerms',{...terms,status:'needs_reconnection',failure:eligibility.reason});
      continue;
    }
    fenceConnection(tx,connection!);
    remindRecurringTerms(tx,terms,at);
    if (terms.status !== 'active' || terms.nextRenewalAt > at || eligibility.status === 'blocked') continue;
    if (eligibility.status === 'review') {
      if (eligibility.reason === 'recurring_invoice_already_exists') insist(false,'recurring_invoice_already_exists',409);
      tx.put('recurringTerms',{...terms,status:'needs_review',failure:eligibility.reason,failedAt:at,
        ...(eligibility.reason === 'billing_period_already_ended' ? {reviewDueAt:eligibility.dueAt,reviewTermEndAt:eligibility.termEndAt} : {})});
      continue;
    }
    const due = eligibility.dueAt, expiresAt = eligibility.termEndAt, invoiceAmountCents = eligibility.amountCents;
    const pack = record(tx.state,terms.currentPackId,'pack');
    const amendment = eligibility.priceDisclosureId ? record(tx.state,eligibility.priceDisclosureId,'renewalDisclosure') : null;
    const invoiceId = `invoice:${terms.id}:${due}`;
    insist(!tx.state.records.has(invoiceId),'recurring_invoice_already_exists',409);
    tx.reached(due); tx.future(expiresAt);
    const next = {id:id(),personId:pack.personId,...packTerms(pack),amountCents:invoiceAmountCents,creditLedgerVersion:1,creditRevision:0,remaining:0,
      termStartAt:due,expiresAt,recurringTermsId:terms.id,renewedFromPackId:pack.id,invoiceId,createdAt:at};
    tx.put('pack',next); appendPackEvent(tx,next,{type:'grant',credits:terms.credits});
    const chargeId = `charge:${invoiceId}`;
    tx.put('charge',{id:chargeId,personId:pack.personId,packId:next.id,invoiceId,recurringTermsId:terms.id,kind:'recurring-invoice',amountCents:invoiceAmountCents,priceDisclosureId:amendment?.id ?? null,createdAt:at});
    tx.put('recurringInvoice',{id:invoiceId,personId:pack.personId,packId:next.id,previousPackId:pack.id,recurringTermsId:terms.id,dueAt:due,termEndAt:expiresAt,
      amountCents:invoiceAmountCents,priceDisclosureId:amendment?.id ?? null,chargeId,status:'open',collection:'studio-balance-only',createdAt:at});
    contractNotice(tx,invoiceId,pack.personId,'Renewal invoice issued',`Invoice for ${due} to ${expiresAt}: $${(invoiceAmountCents/100).toFixed(2)} added to your studio balance. No payment has been collected.`);
    if(amendment)tx.put('renewalDisclosure',{...amendment,appliedAtPrice:at,invoiceId});
    tx.put('recurringTerms',{...terms,amountCents:invoiceAmountCents,currentPriceDisclosureId:amendment?.id ?? terms.currentPriceDisclosureId ?? null,currentPackId:next.id,nextRenewalAt:expiresAt,lastInvoiceId:invoiceId});
  }
}
/** A live origin move preserves only agreements tied to the existing local epoch. */
export async function reconnectRecurringBilling(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const previousOrigin = text(input.previousOrigin,'previousOrigin',2000), origin = text(tx.notices.origin,'billing_origin',2000);
  const connectionId = text(input.connectionId,'connectionId',100), requestId = text(input.requestId,'requestId',100);
  const connection = await tx.db.prepare(connectionSQL).first<BillingConnection>();
  insist(connection && connection.connection_id === connectionId,'fresh_member_acceptance_required',409);
  const prior = list(tx.state,'billingReconnection').find(r => r.requestId === requestId && r.actorId === tx.who.id);
  if (prior) { insist(prior.previousOrigin === previousOrigin && prior.origin === origin && prior.connectionId === connectionId && connection.origin === origin,'reconnection_changed',409); fenceConnection(tx,connection); return prior; }
  insist(connection.origin === previousOrigin && previousOrigin !== origin,'billing_origin_changed',409);
  fenceConnection(tx,connection);
  tx.sql.push(tx.statement("UPDATE st_contract_connections SET origin=?,approved_by=?,approved_at=? WHERE id='billing' AND connection_id=? AND origin=?",origin,tx.who.id,now(),connectionId,previousOrigin));
  fenceConnection(tx,{connection_id:connectionId,origin});
  const affected = list(tx.state,'recurringTerms').filter(r => r.acceptedAt && r.connectionId === connectionId && r.billingOrigin === previousOrigin && ['active','needs_review','needs_reconnection'].includes(r.status) && r.failure !== 'fresh_member_acceptance_required');
  const moved = {id:id(),requestId,connectionId,previousOrigin,origin,actorId:tx.who.id,at:now(),agreementIds:affected.map(r => r.id),personIds:[...new Set(affected.map(r => r.personId))]};
  tx.put('billingReconnection',moved);
  for (const terms of affected) tx.put('recurringTerms',{...terms,billingOrigin:origin,status:terms.status === 'needs_reconnection' ? 'active' : terms.status,failure:terms.status === 'needs_reconnection' ? null : terms.failure,reconnectedAt:moved.at,reconnectedBy:tx.who.id,reconnectionId:moved.id});
  for (const personId of moved.personIds) contractNotice(tx,`billing-reconnection:${moved.id}:${personId}`,personId,'Recurring invoices moved to the new studio address',`The studio address changed from ${previousOrigin} to ${origin}. Your accepted amount, interval and invoice agreement are unchanged and continue until stopped. Stop future invoices in one step after signing in: ${origin}/app/packs#freezes. Access continues to the current term end. ${debtOnly}`);
  return moved;
}
export function recurringSnapshot(state: State, who: Actor, connection?: BillingConnection | null, currentOrigin?: string) {
  const visible = (r: RecordData) => who.role === 'owner' || (who.role === 'member' && r.personId === who.personId);
  const terms = list(state,'recurringTerms').filter(visible).map(r => ({...r,...previewSaleContext(state,r),stopPath:r.stopPath ?? stopPathFor(r.id),
    requiresFreshAcceptance:r.requiresFreshAcceptance === true || connection !== undefined && (!connection || connection.connection_id !== r.connectionId),
    stale:r.status === 'preview' && (!saleContextCurrent(state,r) || connection !== undefined && (!connection || connection.connection_id !== r.connectionId) || r.nextRenewalAt <= now() || currentOrigin !== undefined && r.proposalOrigin !== currentOrigin || !state.records.has(r.packId) || r.basis !== proposalBasis(state,record(state,r.packId,'pack')))}));
  return {terms,invoices:list(state,'recurringInvoice').filter(visible),reminders:list(state,'recurringReminder').filter(visible),
    connection:who.role === 'owner' && connection !== undefined ? {connectionId:connection?.connection_id ?? null,origin:connection?.origin ?? null,currentOrigin:currentOrigin ?? null,
      canReconnect:!!connection && !!currentOrigin && connection.origin !== currentOrigin,requiresFreshAcceptance:!connection} : null};
}

/** Member withdrawal takes effect immediately; the existing term is untouched. */
export function stopRecurringTerms(tx: Transaction, input: Record<string,unknown>) {
  const terms = record(tx.state,input.id,'recurringTerms');
  const member = tx.who.role === 'member' && terms.personId === tx.who.personId;
  insist(tx.who.role === 'owner' && tx.who.isOwner || member,'recurringTerms_not_found',404);
  const reason = member ? null : text(input.reason,'reason',500), requestId = text(input.requestId,'requestId',100);
  if (terms.status === 'stopped') { if (member) return terms; insist(terms.stoppedBy === tx.who.id && terms.stopRequestId === requestId && terms.stopReason === reason,'recurring_terms_stopped',409); return terms; }
  insist(['active','needs_review','needs_reconnection','preview'].includes(terms.status),'recurring_terms_closed',409);
  const stoppedAt = now(), stopChannel = member ? 'member-self-service' : staffChannel(input);
  const stopped = {...terms,status:'stopped',stoppedAt,stoppedBy:tx.who.id,stopRequestId:requestId,stopReason:reason,stopChannel,
    stop:{actorId:tx.who.id,personId:terms.personId,at:stoppedAt,channel:stopChannel,reason,effectiveAt:stoppedAt,accessEndsAt:tx.state.records.get(terms.currentPackId ?? terms.packId)?.data.expiresAt ?? null},
    ...(terms.acceptedAt ? {retention:consentRetention(terms.acceptedAt,stoppedAt)} : {})};
  tx.put('recurringTerms',stopped);
  contractNotice(tx,`recurring-stop:${terms.id}`,terms.personId,'Future renewal invoices stopped','Your invoice agreement stopped immediately. No later renewal invoice or new term will be created. Access continues to the existing term end. Previously recorded invoices and charges remain; no payment or refund was made.');
  return stopped;
}

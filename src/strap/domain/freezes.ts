import { studioDayInstant, calendarDays, shiftCalendarDays } from './freeze-calendar';
import { humanOwner, id, insist, instant, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent, bookingCredit, studioZone } from './pack-credits';
import { bookingHistory } from './booking-history';
import { contractNotice, moveRecurringRenewal, recurringBasis } from './contract-billing';
import { hasStaffRight, requireStaffRight } from './staff-rights';

export function freezeStaffVisible(state: State, who: Actor, packId: string) {
  const pack = state.records.get(packId)?.data;
  return !!pack && state.people.some(p=>p.id===pack.personId && p.active && !p.erasedAt)
    && hasStaffRight(state,who,'contract-change',pack.personId,pack.locationId ?? 'studio')
    && hasStaffRight(state,who,'member-record',pack.personId,pack.locationId ?? 'studio');
}
export function requireFreezeStaff(state: State, who: Actor, packId: unknown) {
  const pack = record(state,packId,'pack'); person(state,pack.personId);
  requireStaffRight(state,who,'contract-change',pack.personId,pack.locationId ?? 'studio');
  requireStaffRight(state,who,'member-record',pack.personId,pack.locationId ?? 'studio');
}
/** Saved targets define authority even when a replay supplies a different pack. */
export function authorizeFreezeCommand(tx: Transaction, name: string, input: Record<string,unknown>) {
  const target = name === 'freeze.prepare'
    ? input.freezeRequestId ? record(tx.state,input.freezeRequestId,'freezeRequest') : null
    : record(tx.state,input.id,name.startsWith('freeze.end.') && name !== 'freeze.end.prepare' ? 'freezeEnd'
      : ['freeze.decline','freeze.request.withdraw'].includes(name) ? 'freezeRequest' : 'freeze');
  requireFreezeStaff(tx.state,tx.who,target?.packId ?? input.packId);
  if (input.packId) requireFreezeStaff(tx.state,tx.who,input.packId);
}

const live = (f: RecordData) => ['scheduled','active'].includes(f.status);
const inside = (f: RecordData, at: string) => at >= f.startAt && (!f.endAt || at < f.endAt);
export const packFreezeBlocks = (state: State, packId: string, at: string) => list(state,'freeze').some(f => f.packId === packId && live(f) && inside(f,at));
const pending = (state: State, packId: string) => list(state,'freeze').some(f => f.packId === packId && live(f));
const weekday = (state: State, at: string) => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(new Intl.DateTimeFormat('en-US',{timeZone:studioZone(state),weekday:'short'}).format(new Date(at)))+1;
const fingerprint = (input: Record<string,unknown>) => JSON.stringify(Object.keys(input).sort().map(k => [k,input[k]]));
function replay(tx: Transaction, kind: string, input: Record<string,unknown>) {
  const requestId = text(input.requestId,'requestId',100), requestBasis = fingerprint(input);
  const prior = list(tx.state,kind).find(r => r.createdBy === tx.who.id && r.requestId === requestId);
  if (prior) insist(prior.requestBasis === requestBasis,'freeze_request_changed',409);
  return {prior,requestId,requestBasis};
}
export function saveFreezeType(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const current = input.id ? record(tx.state,input.id,'freezeType') : null;
  if (current) insist(input.revision === current.revision,'freeze_type_changed',409);
  const days = input.allowedStartDays ?? [1,2,3,4,5,6,7];
  insist(Array.isArray(days) && days.length > 0 && days.length <= 7,'invalid_allowedStartDays');
  const allowedStartDays = [...new Set(days.map(d => integer(d,'allowedStartDays',1,7)))];
  const defaultLengthDays = integer(input.defaultLengthDays,'defaultLengthDays',1,366), maxLengthDays = integer(input.maxLengthDays ?? 366,'maxLengthDays',defaultLengthDays,3660);
  insist(input.allowOpenEnded === undefined || typeof input.allowOpenEnded === 'boolean','invalid_allowOpenEnded');
  const optionalCap = (key: string) => input[key] === undefined || input[key] === '' || input[key] === null ? null : integer(input[key],key,1,365);
  const type = {maxFreezes:optionalCap('maxFreezes'),maxDays:optionalCap('maxDays'),id:current?.id ?? id(),name:text(input.name,'name',100),reason:text(input.reason,'reason',500),feeCents:integer(input.feeCents,'feeCents',0,100_000_000),
    defaultLengthDays,maxLengthDays,allowedStartDays,allowOpenEnded:input.allowOpenEnded === true,revision:(current?.revision ?? 0)+1,updatedBy:tx.who.id,updatedAt:now()};
  tx.put('freezeType',type); return type;
}
function assertFreezeCaps(state: State, type: RecordData, startAt: string, endAt: string | null, personId: string) {
  if (!type.maxFreezes && !type.maxDays) return;
  insist(endAt,'freeze_cap_requires_end',409);
  const freezes = list(state,'freeze').filter(f=>f.personId===personId && f.freezeTypeId===type.id && f.confirmedAt && !['withdrawn','declined'].includes(f.status));
  const proposed={startAt,endAt};
  // An earlier insertion must also preserve every already-agreed later window.
  for (const anchor of [proposed,...freezes.filter(f=>f.startAt>=startAt)]) {
    const since=shiftCalendarDays(anchor.startAt,-365,studioZone(state));
    const window=[...freezes,proposed].filter(f=>f.startAt>since&&f.startAt<=anchor.startAt);
    insist(!type.maxFreezes || window.length<=type.maxFreezes,'freeze_count_cap_reached',409);

  }
  if(type.maxDays){
    const intervals=[...freezes,proposed].map(f=>({startAt:String(f.startAt),endAt:String(f.endAt??shiftCalendarDays(endAt,365,studioZone(state)))}));
    const anchors=new Set(intervals.flatMap(f=>[f.endAt,shiftCalendarDays(f.startAt,365,studioZone(state))]));
    for(const anchor of anchors){
      const since=shiftCalendarDays(anchor,-365,studioZone(state));
      if(anchor<=startAt||since>=endAt)continue;
      const days=intervals.reduce((total,f)=>{const start=f.startAt>since?f.startAt:since,end=f.endAt<anchor?f.endAt:anchor;return total+(end>start?calendarDays(start,end,studioZone(state)):0);},0);
      insist(days<=type.maxDays,'freeze_day_cap_reached',409);
    }
  }
}
function terms(state: State, input: Record<string,unknown>, memberRequest = false) {
  const type = record(state,input.freezeTypeId,'freezeType'), startAt = studioDayInstant(input.startAt,studioZone(state));
  const endAt = input.endAt === null ? null : input.endAt === undefined || input.endAt === '' ? shiftCalendarDays(startAt,type.defaultLengthDays,studioZone(state)) : studioDayInstant(input.endAt,studioZone(state));
  insist(startAt > now(),'freeze_start_must_be_future');
  insist(!endAt || endAt > startAt,'freeze_end_must_follow_start');
  insist(!memberRequest || endAt,'member_freeze_end_required');
  const feeCents = input.feeCents === undefined ? type.feeCents : integer(input.feeCents,'feeCents',0,100_000_000);
  const reason = input.reason ? text(input.reason,'reason',500) : type.reason;
  const exceptions = [!type.allowedStartDays.includes(weekday(state,startAt)) ? 'start_day' : null,
    endAt && calendarDays(startAt,endAt,studioZone(state))>type.maxLengthDays ? 'length' : null,
    !endAt && !type.allowOpenEnded ? 'open_ended' : null,feeCents !== type.feeCents ? 'fee' : null].filter(Boolean);
  return {freezeTypeId:type.id,typeName:type.name,startAt,endAt,reason,feeCents,exceptions};
}
function affected(state: State, packId: string, freeze: RecordData) {
  return list(state,'booking').filter(b => (b.packId === packId || b.guestPackId === packId) && ['booked','waitlisted','offered'].includes(b.status)).flatMap(b => {
    const c = state.records.get(b.classId)?.data;
    return c && c.start > now() && inside(freeze,c.start) ? [{booking:b,class:c}] : [];
  }).sort((a,b) => a.booking.id.localeCompare(b.booking.id));
}
export function freezeBasis(state: State, pack: RecordData, freeze: RecordData) {
  // Full records bind allocation changes, attendance, class moves, consent and policy revisions.
  return JSON.stringify({pack,member:person(state,pack.personId,false),type:record(state,freeze.freezeTypeId,'freezeType'),recurring:recurringBasis(state,pack.id),
    affected:affected(state,pack.id,freeze).map(effect => ({...effect,fundingPack:effect.booking.packId ? state.records.get(effect.booking.packId)?.data ?? null : null})),freezes:list(state,'freeze').filter(f => f.packId === pack.id && live(f)),
    changes:list(state,'planChange').filter(c => c.packId === pack.id && c.status === 'accepted')});
}
function freezeEffects(state: State, pack: RecordData, freeze: RecordData) {
  const bookings = affected(state,pack.id,freeze).map(({booking:b,class:c}) => ({bookingId:b.id,classId:c.id,title:c.title,start:c.start,status:b.status,packId:b.packId ?? null,
    creditReturned:b.status === 'booked' && !!(b.packId || b.guestPackId || b.makeupCreditId),feeCents:0,effect:b.guestPackId ? 'cancel and return guest pass or reverse guest price once' : b.makeupCreditId ? 'cancel and return linked makeup credit with original expiry' : b.packId ? 'cancel and return original funding once' : 'cancel; no funding used'}));
  const durationDays = freeze.endAt ? calendarDays(freeze.startAt,freeze.endAt,studioZone(state)) : null;
  const revisedExpiresAt = durationDays === null ? null : shiftCalendarDays(pack.expiresAt,durationDays,studioZone(state)), recurring = recurringBasis(state,pack.id);
  return {durationDays,bookings,remainingCredits:pack.remaining,creditsReturned:bookings.filter(b => b.creditReturned && !!b.packId && (!state.records.get(b.packId!)?.data.entitlement || state.records.get(b.packId!)?.data.entitlement.kind === 'credits')).length,
    originalExpiresAt:pack.expiresAt,revisedExpiresAt,originalRenewalAt:recurring?.nextRenewalAt ?? null,revisedRenewalAt:recurring ? revisedExpiresAt : null,
    renewalAmountCents:recurring?.amountCents ?? null,recurringTermsId:recurring?.id ?? null,
    access:'This plan cannot fund classes starting in the freeze interval. Bookings on other plans and separate makeup credits stay unchanged.',
    billing:recurring ? 'An agreed recurring invoice moves by the frozen calendar days; it adds the agreed amount to the studio balance once. No payment is collected.' : 'This finite pack has no automatic renewal. Its expiry moves by the frozen calendar days.',
    autopays:[],paymentCollection:'none'};
}
export function requestFreeze(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_required',403);
  const pack = record(tx.state,input.packId,'pack'); insist(pack.personId === tx.who.personId,'pack_not_found',404);
  const prior = replay(tx,'freezeRequest',input); if (prior.prior) return prior.prior;
  const dates = terms(tx.state,input,true); text(input.reason,'reason',500);
  insist(pack.expiresAt > dates.startAt,'freeze_start_outside_term',409);
  insist(!pending(tx.state,pack.id),'freeze_pending',409);
  assertFreezeCaps(tx.state,record(tx.state,dates.freezeTypeId,'freezeType'),dates.startAt,dates.endAt,pack.personId);
  const request = {id:id(),personId:pack.personId,packId:pack.id,...dates,requestId:prior.requestId,requestBasis:prior.requestBasis,status:'requested',createdAt:now(),createdBy:tx.who.id};
  tx.put('freezeRequest',request); return request;
}
export function prepareFreeze(tx: Transaction, input: Record<string,unknown>) {
  authorizeFreezeCommand(tx,'freeze.prepare',input);
  const prior = replay(tx,'freeze',input); if (prior.prior) return prior.prior;
  const request = input.freezeRequestId ? record(tx.state,input.freezeRequestId,'freezeRequest') : null;
  const pack = record(tx.state,input.packId ?? request?.packId,'pack'); person(tx.state,pack.personId);
  insist(!request || request.packId === pack.id && request.status === 'requested','freeze_request_closed',409);
  insist(!pending(tx.state,pack.id),'freeze_pending',409);
  insist(!list(tx.state,'planChange').some(c => c.packId === pack.id && c.status === 'accepted'),'plan_change_pending',409);
  const dates = terms(tx.state,{...request,...input});
  insist(pack.expiresAt > dates.startAt,'freeze_start_outside_term',409);
  const exceptionReason = input.exceptionReason ? text(input.exceptionReason,'exceptionReason',500) : null;
  const changedRequest = request && ['startAt','endAt','feeCents','reason','freezeTypeId'].some(k => request[k] !== dates[k as keyof typeof dates]);
  insist(!(dates.exceptions.length || changedRequest) || exceptionReason,'exception_reason_required');
  assertFreezeCaps(tx.state,record(tx.state,dates.freezeTypeId,'freezeType'),dates.startAt,dates.endAt,pack.personId);
  const freeze = {requiresAcceptance:dates.feeCents>0 || !!changedRequest || dates.exceptions.length>0,acceptedAt:null,originalAllowanceExpiresAt:pack.allowanceExpiresAt ?? null,id:id(),personId:pack.personId,packId:pack.id,...dates,requestId:prior.requestId,requestBasis:prior.requestBasis,freezeRequestId:request?.id ?? null,
    exceptionReason,approvedExceptionBy:exceptionReason ? tx.who.id : null,changedRequest:!!changedRequest,status:'preview',createdAt:now(),createdBy:tx.who.id};
  const preview = {...freeze,effects:freezeEffects(tx.state,pack,freeze),basis:freezeBasis(tx.state,pack,freeze)};
  const saved = {...preview,key:JSON.stringify(preview)};
  tx.put('freeze',saved); return saved;
}
export function confirmFreeze(tx: Transaction, input: Record<string,unknown>) {
  authorizeFreezeCommand(tx,'freeze.confirm',input); text(input.requestId,'requestId',100);
  const freeze = record(tx.state,input.id,'freeze'); insist(input.key === freeze.key,'preview_changed',409);
  if (freeze.confirmedAt) { insist(freeze.confirmedBy === tx.who.id && freeze.confirmationRequestId === input.requestId && freeze.confirmationBasis === fingerprint(input),'freeze_confirmation_closed',409); return freeze; }
  insist(freeze.status === 'preview' && freeze.startAt > now(),'freeze_preview_expired',409);
  const pack = record(tx.state,freeze.packId,'pack');
  insist(freezeBasis(tx.state,pack,freeze) === freeze.basis,'freeze_source_changed',409);
  insist(!freeze.requiresAcceptance || (freeze.acceptedAt && freeze.acceptanceBasis === freeze.basis),'freeze_member_acceptance_required',409);
  if (freeze.freezeRequestId) insist(record(tx.state,freeze.freezeRequestId,'freezeRequest').status === 'requested','freeze_request_closed',409);
  assertFreezeCaps(tx.state,record(tx.state,freeze.freezeTypeId,'freezeType'),freeze.startAt,freeze.endAt,pack.personId);
  insist(!pending(tx.state,pack.id),'freeze_pending',409); tx.future(freeze.startAt);
  const actionId = id(), at = now();
  for (const effect of freeze.effects.bookings) {
    const booking = record(tx.state,effect.bookingId,'booking');
    if (effect.creditReturned) bookingCredit(tx,booking,{type:'restore',credits:1,bookingId:booking.id,classId:booking.classId,reason:`Freeze ${freeze.id}`});
    const cancelled = {...booking,status:'cancelled',cancellation:'freeze',cancellationId:`freeze:${freeze.id}:${booking.id}`,cancelledAt:at,cancelledBy:tx.who.id,cancelledByRole:tx.who.role,
      refunded:effect.creditReturned,feeCents:0,freezeId:freeze.id};
    tx.put('booking',cancelled);
    if(booking.guestPackId)contractNotice(tx,`freeze-guest:${freeze.id}:${booking.id}`,booking.personId,'Guest booking cancelled for a membership freeze','The host’s agreed freeze cancelled this guest seat. Its original guest pass was returned or its original studio-balance price was reversed once to the original payer. No cancellation fee, payment or external refund was made.',[booking.id]);
    bookingHistory(tx,'cancel',booking,cancelled,{reason:'Agreed membership freeze',channel:input.channel ?? 'desk'}, {id:cancelled.cancellationId,parentActionId:actionId});
  }
  if (freeze.effects.revisedExpiresAt) {
    tx.put('pack',{...record(tx.state,pack.id,'pack'),allowanceExpiresAt:pack.allowanceExpiresAt ?? pack.expiresAt});
    appendPackEvent(tx,record(tx.state,pack.id,'pack'),{type:'adjust',credits:0,expiresAt:freeze.effects.revisedExpiresAt,reason:`Freeze ${freeze.id}`});
    moveRecurringRenewal(tx,pack.id,freeze.effects.revisedExpiresAt,freeze.id);
  }
  const chargeId = freeze.feeCents ? `charge:freeze:${freeze.id}` : null;
  if (chargeId) tx.put('charge',{id:chargeId,personId:pack.personId,packId:pack.id,freezeId:freeze.id,kind:'freeze-fee',amountCents:freeze.feeCents,createdAt:at});
  const confirmed = {...freeze,status:'scheduled',confirmedAt:at,confirmedBy:tx.who.id,confirmationRequestId:input.requestId,confirmationBasis:fingerprint(input),staffActionId:actionId,chargeId};
  tx.put('freeze',confirmed);
  if (freeze.freezeRequestId) { const request = record(tx.state,freeze.freezeRequestId,'freezeRequest'); tx.put('freezeRequest',{...request,status:'approved',freezeId:freeze.id}); }
  contractNotice(tx,`freeze-confirm:${freeze.id}`,pack.personId,'Membership freeze confirmed',noticeBody(confirmed),freeze.effects.bookings.map((b: RecordData) => b.bookingId));
  return confirmed;
}
function noticeBody(f: RecordData) {
  return `Freeze from ${f.startAt} until ${f.endAt ?? 'staff agree a resumption date'}. Freeze fee $${(f.feeCents/100).toFixed(2)} added to the studio balance once; no payment collected. ${f.effects.access} ${f.effects.bookings.length} future booking(s) cancelled with original funding returned once and no cancellation fee. Term expiry ${f.effects.revisedExpiresAt ?? 'will move by the frozen calendar days when staff agree the end'}. ${f.effects.billing} ${f.effects.revisedRenewalAt ? `Next invoice ${f.effects.revisedRenewalAt}, $${(f.effects.renewalAmountCents/100).toFixed(2)}.` : ''}`;
}
export function freezeEndBasis(state: State, freeze: RecordData) {
  return JSON.stringify({freeze,pack:record(state,freeze.packId,'pack'),recurring:recurringBasis(state,freeze.packId),member:person(state,freeze.personId,false)});
}
export function prepareEndFreeze(tx: Transaction, input: Record<string,unknown>) {
  authorizeFreezeCommand(tx,'freeze.end.prepare',input);
  const prior = replay(tx,'freezeEnd',input); if (prior.prior) return prior.prior;
  const freeze = record(tx.state,input.id,'freeze'); insist(live(freeze),'freeze_not_live',409);
  const endAt = studioDayInstant(input.endAt,studioZone(tx.state));
  insist(endAt > now() && endAt > freeze.startAt && (!freeze.endAt || endAt < freeze.endAt),'invalid_early_resumption');
  const reason = text(input.reason,'reason',500), revisedExpiresAt = shiftCalendarDays(freeze.effects.originalExpiresAt,calendarDays(freeze.startAt,endAt,studioZone(tx.state)),studioZone(tx.state));
  const pack = record(tx.state,freeze.packId,'pack'), expected = freeze.effects.revisedExpiresAt ?? freeze.effects.originalExpiresAt;
  insist(pack.expiresAt === expected,'freeze_term_changed',409);
  // Do not shorten the term past an allocation which survived the original preview.
  insist(!list(tx.state,'booking').some(b => b.packId === pack.id && b.status === 'booked' && (tx.state.records.get(b.classId)?.data.start ?? '') >= revisedExpiresAt),'resumption_conflicts_with_bookings',409);
  const preview = {id:id(),freezeId:freeze.id,personId:freeze.personId,packId:freeze.packId,endAt,reason,revisedExpiresAt,
    revisedRenewalAt:recurringBasis(tx.state,freeze.packId) ? revisedExpiresAt : null,renewalAmountCents:freeze.effects.renewalAmountCents,feeCents:0,bookingsRestored:[],
    requiresAcceptance:true,acceptedAt:null,status:'preview',requestId:prior.requestId,requestBasis:prior.requestBasis,createdBy:tx.who.id,createdAt:now(),basis:freezeEndBasis(tx.state,freeze)};
  const saved = {...preview,key:JSON.stringify(preview)}; tx.put('freezeEnd',saved); return saved;
}
export function confirmEndFreeze(tx: Transaction, input: Record<string,unknown>) {
  authorizeFreezeCommand(tx,'freeze.end.confirm',input); text(input.requestId,'requestId',100);
  const end = record(tx.state,input.id,'freezeEnd'); insist(input.key === end.key,'preview_changed',409);
  if (end.status === 'confirmed') { insist(end.confirmedBy === tx.who.id && end.confirmationRequestId === input.requestId && end.confirmationBasis === fingerprint(input),'freeze_confirmation_closed',409); return end; }
  const freeze = record(tx.state,end.freezeId,'freeze');
  insist(end.acceptedAt && end.acceptanceBasis === end.basis,'freeze_member_acceptance_required',409);
  insist(end.endAt > now() && live(freeze),'freeze_end_preview_expired',409);
  insist(end.basis === freezeEndBasis(tx.state,freeze),'freeze_source_changed',409); tx.future(end.endAt);
  const pack=record(tx.state,freeze.packId,'pack');
  tx.put('pack',{...pack,allowanceExpiresAt:pack.allowanceExpiresAt ?? freeze.effects.originalExpiresAt});
  appendPackEvent(tx,record(tx.state,freeze.packId,'pack'),{type:'adjust',credits:0,expiresAt:end.revisedExpiresAt,reason:`Early resumption ${end.id}`});
  moveRecurringRenewal(tx,freeze.packId,end.revisedExpiresAt,freeze.id);
  const updated = {...freeze,endAt:end.endAt,endReason:end.reason,endPreviewId:end.id,effects:{...freeze.effects,revisedExpiresAt:end.revisedExpiresAt,revisedRenewalAt:end.revisedRenewalAt,durationDays:calendarDays(freeze.startAt,end.endAt,studioZone(tx.state))}};
  tx.put('freeze',updated);
  const confirmed = {...end,status:'confirmed',confirmedBy:tx.who.id,confirmationRequestId:input.requestId,confirmationBasis:fingerprint(input),confirmedAt:now()}; tx.put('freezeEnd',confirmed);
  contractNotice(tx,`freeze-end:${end.id}`,freeze.personId,'Earlier resumption agreed',`${noticeBody(updated)} Previously cancelled bookings are not automatically restored. No additional freeze fee.`);
  return confirmed;
}
/** The minute sweep and command fence use agreed instants, even after a restart crossing both dates. */
export function applyDueFreezes(tx: Transaction) {
  const at = now();
  for (const freeze of list(tx.state,'freeze').filter(live)) {
    if (freeze.endAt && freeze.endAt <= at) {
      tx.reached(freeze.endAt);
      tx.put('freeze',{...freeze,status:'resumed',resumedAt:freeze.endAt,processedAt:at,resumptionCount:1});
      contractNotice(tx,`freeze-resume:${freeze.id}`,freeze.personId,'Membership resumed',`Your membership resumed at the agreed ${freeze.endAt}. Term expiry ${freeze.effects.revisedExpiresAt}. ${freeze.effects.revisedRenewalAt ? `Next invoice ${freeze.effects.revisedRenewalAt}: $${(freeze.effects.renewalAmountCents/100).toFixed(2)} added once to the studio balance when due; no payment collected.` : 'There is no automatic renewal.'} Previously cancelled bookings stay cancelled.`);
    } else if (freeze.status === 'scheduled' && freeze.startAt <= at) { tx.reached(freeze.startAt); tx.put('freeze',{...freeze,status:'active',startedAt:freeze.startAt}); }
  }
}
export function freezesSnapshot(state: State, who: Actor) {
  const staff = ['front-desk','manager'].includes(who.role);
  const visible = (r: RecordData) => who.role === 'owner' || (who.role === 'member' && r.personId === who.personId) || staff && freezeStaffVisible(state,who,r.packId);
  const allowed = who.role === 'owner' || who.role === 'member' || staff && list(state,'pack').some(p=>freezeStaffVisible(state,who,p.id));
  return {types:allowed ? list(state,'freezeType') : [],requests:list(state,'freezeRequest').filter(visible),freezes:list(state,'freeze').filter(visible).map(f => ({...f,
    stale:f.status === 'preview' && (f.startAt <= now() || !state.records.has(f.packId) || f.basis !== freezeBasis(state,record(state,f.packId,'pack'),f))})),
    ends:list(state,'freezeEnd').filter(visible).map(e => ({...e,stale:e.status === 'preview' && (e.endAt <= now() || e.basis !== freezeEndBasis(state,record(state,e.freezeId,'freeze')))}))};
}

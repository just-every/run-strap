import { localInstant } from '../zone';
import { messageBody, putNotice, reserveMail } from './notices';
import { studioSettings } from './studio';
import type { Transaction } from './store';
import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';

// This authority opens makeup records only. It grants no waiver-signing,
// household, payer, profile or general member-account access.
const activeMember = (state: State, personId: unknown) => state.people.some(p => p.id === personId && p.role === 'member' && p.active && !p.erasedAt);
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;

function legalExpiry(grant: RecordData): string | null {
  if (!grant.youthVerified || !validDate(grant.adultOn) || typeof grant.adultAt !== 'string' || !Number.isFinite(Date.parse(grant.adultAt))) return null;
  const at = new Date(grant.adultAt).toISOString();
  return at === grant.adultAt ? at : null;
}

function currentGrant(state: State, grant: RecordData, at: string) {
  if (grant.revokedAt || !activeMember(state,grant.personId) || !activeMember(state,grant.guardianId) || !grant.guardianAcceptedAt) return false;
  if (grant.relationship === 'adult-delegate') return !!grant.participantAcceptedAt;
  if (grant.relationship !== 'legal-guardian') return false;
  const expiresAt = legalExpiry(grant);
  return !!expiresAt && expiresAt > at;
}

export function canManageMakeup(state: State, who: Actor, personId: string) {
  if (!activeMember(state,personId)) return false;
  if (who.role === 'owner' && who.isOwner) return true;
  if (who.role !== 'member' || !activeMember(state,who.personId)) return false;
  return who.personId === personId || list(state,'makeupGuardian').some(r => r.personId === personId && r.guardianId === who.personId && currentGrant(state,r,now()));
}

export function authorizeMakeup(tx: Transaction, personId: string) {
  person(tx.state,personId);
  insist(canManageMakeup(tx.state,tx.who,personId),'makeup_not_found',404);
  if (tx.who.role !== 'member' || tx.who.personId === personId) return;
  const grant = list(tx.state,'makeupGuardian').find(r => r.personId === personId && r.guardianId === tx.who.personId && currentGrant(tx.state,r,now()));
  insist(grant,'makeup_not_found',404);
  // The shared state revision fences revocation and identity changes. The
  // birthday also needs a clock assertion after any wait before commit.
  if (grant.relationship === 'legal-guardian') tx.future(legalExpiry(grant)!);
}

export function saveMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const participant = person(tx.state,input.personId), guardian = person(tx.state,input.guardianId);
  insist(participant.role === 'member' && guardian.role === 'member' && participant.id !== guardian.id,'invalid_makeup_guardian');
  const relationship = text(input.relationship,'relationship',30), authorizationEvidence = text(input.authorizationEvidence,'authorizationEvidence',500);
  insist(relationship === 'legal-guardian' || relationship === 'adult-delegate','invalid_relationship');
  const adultOn = input.adultOn === undefined || input.adultOn === null || input.adultOn === '' ? null : text(input.adultOn,'adultOn',10);
  insist(adultOn === null || validDate(adultOn),'invalid_adultOn');
  const prior = list(tx.state,'makeupGuardian').find(r => r.personId === participant.id && r.guardianId === guardian.id && !r.revokedAt);
  if (prior) {
    insist(prior.relationship === relationship && prior.authorizationEvidence === authorizationEvidence && (prior.adultOn ?? null) === adultOn,'makeup_guardian_request_changed',409);
    if (relationship === 'legal-guardian') {
      const expiresAt = legalExpiry(prior);
      insist(expiresAt && expiresAt > now(),'makeup_guardian_expired',409); tx.future(expiresAt);
    }
    return prior;
  }
  insist(relationship !== 'legal-guardian' || adultOn !== null,'invalid_adultOn');
  const adultAt = adultOn ? new Date(localInstant(adultOn,'00:00',studioSettings(tx.state)?.timeZone ?? 'UTC')).toISOString() : null;
  if (relationship === 'legal-guardian') {
    insist(adultAt && adultAt > now(),'invalid_adultOn'); tx.future(adultAt);
  }
  const grant = {id:id(),personId:participant.id,guardianId:guardian.id,relationship,authorizationEvidence,adultOn,adultAt,youthVerified:relationship === 'legal-guardian',createdAt:now(),createdBy:tx.who.id,participantAcceptedAt:null,guardianAcceptedAt:null,revokedAt:null,revocationReason:null};
  tx.put('makeupGuardian',grant); return grant;
}

export function acceptMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && activeMember(tx.state,tx.who.personId),'member_required',403);
  const grant = record(tx.state,input.id,'makeupGuardian');
  insist(!grant.revokedAt && activeMember(tx.state,grant.personId) && activeMember(tx.state,grant.guardianId)
    && [grant.personId,grant.guardianId].includes(tx.who.personId),'makeup_not_found',404);
  insist(grant.relationship === 'adult-delegate' || (grant.relationship === 'legal-guardian' && tx.who.personId === grant.guardianId),'makeup_not_found',404);
  if (grant.relationship === 'legal-guardian') {
    const expiresAt = legalExpiry(grant);
    insist(expiresAt && expiresAt > now(),'makeup_not_found',404); tx.future(expiresAt);
  }
  const field = tx.who.personId === grant.personId ? 'participantAcceptedAt' : 'guardianAcceptedAt';
  if (grant[field]) return grant;
  const updated = {...grant,[field]:now(),[field.replace('At','By')]:tx.who.id};
  tx.put('makeupGuardian',updated); return updated;
}

export function revokeMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  const grant = record(tx.state,input.id,'makeupGuardian');
  const owner = tx.who.role === 'owner' && tx.who.isOwner;
  const member = tx.who.role === 'member' && activeMember(tx.state,tx.who.personId);
  insist(owner || (member && (tx.who.personId === grant.guardianId || (grant.relationship === 'adult-delegate' && tx.who.personId === grant.personId))),'makeup_not_found',404);
  if (grant.revokedAt) return grant;
  const reason = owner ? text(input.reason,'reason',500) : input.reason === undefined || input.reason === null || input.reason === '' ? null : text(input.reason,'reason',500);
  const updated = {...grant,revokedAt:now(),revokedBy:tx.who.id,revocationReason:reason};
  tx.put('makeupGuardian',updated); return updated;
}

export function launchMakeupGuardian(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const grant = record(tx.state,input.id,'makeupGuardian');
  insist(!grant.revokedAt && activeMember(tx.state,grant.personId) && activeMember(tx.state,grant.guardianId),'makeup_not_found',404);
  insist(grant.relationship === 'legal-guardian' || grant.relationship === 'adult-delegate','makeup_not_found',404);
  if (grant.relationship === 'legal-guardian') {
    const expiresAt = legalExpiry(grant);
    insist(expiresAt && expiresAt > now(),'makeup_not_found',404); tx.future(expiresAt);
  }
  return {id:id(),personId:grant.personId,guardianId:grant.guardianId,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fmakeups'};
}

export function makeupRecipients(tx: Transaction, personId: string): string[] {
  person(tx.state,personId);
  insist(activeMember(tx.state,personId),'makeup_not_found',404);
  const recipients = new Set([personId]), at = now();
  for (const grant of list(tx.state,'makeupGuardian')) {
    if (grant.personId !== personId || !currentGrant(tx.state,grant,at)) continue;
    if (grant.relationship === 'legal-guardian') tx.future(legalExpiry(grant)!);
    recipients.add(grant.guardianId);
  }
  return [...recipients];
}

export function makeupNotice(tx: Transaction, personId: string, notice: {id: string; subject: string; body: string; bookingIds?: string[]}) {
  const bookingIds = notice.bookingIds ?? [], body = messageBody(tx.state,notice.body,bookingIds);
  for (const recipient of makeupRecipients(tx,personId)) {
    const suffix = recipient === personId ? '' : `:guardian:${recipient}`, noticeId = `notice:${notice.id}${suffix}`;
    if (tx.state.records.has(noticeId)) continue;
    putNotice(tx,{id:noticeId,personId:recipient,subject:notice.subject,body,...(bookingIds.length === 1 ? {bookingId:bookingIds[0]} : {})},true);
    reserveMail(tx,tx.notices,{id:`mail:${notice.id}${suffix}`,sourceKind:'booking_action',sourceId:notice.id,personId:recipient,bookingIds,subject:notice.subject,body,prepared:true});
  }
}

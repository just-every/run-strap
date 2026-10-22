import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { phoneDigits } from './phone';

// MEM-002. A household retains individual participants (children or adults who book for themselves), the guardians
// who book and sign for them, permissioned contacts and one payer. Conservative defaults (ct to confirm): a person
// belongs to one household; a guardian link needs a recorded evidence reference and a signed-in-capable identity; a
// guardian reaches the participants' own classes, bookings, waiver, packs and notices and nothing else of the household
// or any other; the payer sees only the charges placed on their own balance, never a participant's bookings; a contact
// is a name and phone with named permissions and never an account. Making someone the payer completes only when that
// payer accepts, signed in; their own stored-method authorization (BILL-004) is not implemented and stays owed.
export const households = (state: State) => list(state,'household');
export const householdOf = (state: State, personId: string) => households(state).find(h => h.guardianIds.includes(personId) || h.participantIds.includes(personId) || h.payerId === personId);
export const guardianOf = (state: State, guardianId: unknown, participantId: unknown) => households(state).some(h => h.guardianIds.includes(guardianId) && h.participantIds.includes(participantId));
export const wardsOf = (state: State, guardianId: string | undefined): Set<string> => new Set(guardianId ? households(state).filter(h => h.guardianIds.includes(guardianId)).flatMap(h => h.participantIds) : []);
/** Who a participant's sale or fee is charged to: their household's payer, else themselves. */
export function debtorOf(state: State, personId: string): string {
  return households(state).find(h => h.participantIds.includes(personId) && h.payerId)?.payerId ?? personId;
}

const permissionNames = ['pickup','emergency'];
function fenced(h: RecordData, input: Record<string,unknown>) {
  if (input.revision !== undefined) insist(input.revision === h.revision,'household_changed',409);
}
function put(tx: Transaction, h: RecordData, change: Record<string,unknown>, subject?: string) {
  const saved = {...h,...change,revision:h.revision+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('household',saved);
  return {...saved,...(subject ? {personId:subject} : {})};
}
function freeMember(tx: Transaction, key: unknown, home?: RecordData) {
  const member = person(tx.state,key);
  insist(member.role === 'member','member_required');
  const other = householdOf(tx.state,member.id);
  insist(!other || other.id === home?.id,'person_in_another_household',409);
  return member;
}

export function saveHousehold(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const previous = input.id === undefined || input.id === '' ? null : record(tx.state,input.id,'household');
  const name = text(input.name,'household_name',120);
  const h = previous ?? {id:id(),guardianIds:[],guardianEvidence:{},participantIds:[],contacts:[],payerId:null,pendingPayer:null,revision:0,createdAt:now(),createdBy:tx.who.id};
  if (previous) fenced(h,input);
  return put(tx,h,{name});
}
export function linkGuardian(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  const guardian = freeMember(tx,input.guardianId,h);
  insist(guardian.email,'guardian_needs_sign_in_email');
  insist(!h.participantIds.includes(guardian.id) && !h.guardianIds.includes(guardian.id),'already_in_household',409);
  const evidence = text(input.evidenceReference,'evidenceReference',160);
  return put(tx,h,{guardianIds:[...h.guardianIds,guardian.id].sort(),guardianEvidence:{...h.guardianEvidence,[guardian.id]:{evidenceReference:evidence,linkedAt:now(),linkedBy:tx.who.id}}},guardian.id);
}
/** The guardian's authority ends at once: their next request no longer reaches the participants. */
export function removeGuardian(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  const guardianId = text(input.guardianId,'guardianId',100);
  insist(h.guardianIds.includes(guardianId),'guardian_not_found',404);
  const {[guardianId]:gone,...kept} = h.guardianEvidence;
  return put(tx,h,{guardianIds:h.guardianIds.filter((g: string) => g !== guardianId),guardianEvidence:kept,removedGuardians:[...(h.removedGuardians ?? []),{personId:guardianId,removedAt:now(),removedBy:tx.who.id,reason:typeof input.reason === 'string' ? input.reason.slice(0,300) : null,evidenceReference:gone?.evidenceReference ?? null}]},guardianId);
}
/** A member ends their own guardianship; the staff pair is removeGuardian on their request. */
export function leaveGuardianship(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const h = households(tx.state).find(x => x.id === input.id && x.guardianIds.includes(tx.who.personId));
  insist(h,'household_not_found',404);
  const guardianId = tx.who.personId!, {[guardianId]:gone,...kept} = h.guardianEvidence;
  return put(tx,h,{guardianIds:h.guardianIds.filter((g: string) => g !== guardianId),guardianEvidence:kept,removedGuardians:[...(h.removedGuardians ?? []),{personId:guardianId,removedAt:now(),removedBy:guardianId,reason:'left by the guardian',evidenceReference:gone?.evidenceReference ?? null}]},guardianId);
}
/** An existing member, or a new person added at the desk who has no email and cannot sign in. */
export function addParticipant(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  let participantId: string;
  if (input.personId !== undefined && input.personId !== '') {
    const member = freeMember(tx,input.personId,h);
    insist(!h.guardianIds.includes(member.id) && h.payerId !== member.id,'already_in_household',409);
    participantId = member.id;
  } else {
    const created = {id:id(),name:text(input.name,'name',160),email:null,role:'member' as const,active:true,version:1,erasedAt:null};
    tx.sql.push(tx.statement('INSERT INTO st_people(id,name,email,role,active,version) VALUES(?,?,?,?,?,?)',created.id,created.name,null,'member',1,1));
    tx.state.people.push(created);
    participantId = created.id;
  }
  insist(h.participantIds.length < 20,'household_full',409);
  return put(tx,h,{participantIds:[...h.participantIds,participantId]},participantId);
}
export function removeParticipant(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  const participantId = text(input.participantId,'participantId',100);
  insist(h.participantIds.includes(participantId),'participant_not_found',404);
  return put(tx,h,{participantIds:h.participantIds.filter((p: string) => p !== participantId)},participantId);
}
export function saveContact(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  const permissions = Array.isArray(input.permissions) ? [...new Set(input.permissions.map(String))].sort() : [];
  insist(permissions.every(p => permissionNames.includes(p)),'invalid_permissions');
  const phone = phoneDigits(input.phone); insist(phone,'invalid_phone');
  const contact = {id:typeof input.contactId === 'string' && input.contactId ? input.contactId : id(),name:text(input.name,'name',120),phone,relationship:input.relationship ? text(input.relationship,'relationship',60) : null,permissions};
  const others = h.contacts.filter((c: RecordData) => c.id !== contact.id);
  insist(others.length < 10,'too_many_contacts',409);
  return put(tx,h,{contacts:[...others,contact]});
}
export function removeContact(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  insist(h.contacts.some((c: RecordData) => c.id === input.contactId),'contact_not_found',404);
  return put(tx,h,{contacts:h.contacts.filter((c: RecordData) => c.id !== input.contactId)});
}

/** Proposing a payer changes nothing until that payer accepts, signed in. */
export function proposePayer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  const payer = freeMember(tx,input.payerId,h);
  insist(payer.email,'payer_needs_sign_in_email');
  insist(!h.participantIds.includes(payer.id) && h.payerId !== payer.id,'payer_unchanged',409);
  return put(tx,h,{pendingPayer:{personId:payer.id,proposedAt:now(),proposedBy:tx.who.id,previousPayerId:h.payerId}},payer.id);
}
export function cancelPayerProposal(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const h = record(tx.state,input.id,'household'); fenced(h,input);
  insist(h.pendingPayer,'no_pending_payer',409);
  return put(tx,h,{pendingPayer:null},h.pendingPayer.personId);
}
/** The staff pair of the payer's own acceptance: it launches, never accepts for them. */
export function launchPayerAcceptance(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const h = record(tx.state,input.id,'household');
  insist(h.pendingPayer,'no_pending_payer',409);
  return {id:h.id,personId:h.pendingPayer.personId,status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fhousehold'};
}
/** The payer's own step: they take responsibility for the participants' charges on their studio balance. */
export function acceptPayer(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const h = households(tx.state).find(x => x.id === input.id && x.pendingPayer?.personId === tx.who.personId);
  insist(h,'household_not_found',404);
  const change = {id:id(),householdId:h.id,fromPayerId:h.payerId,toPayerId:tx.who.personId,proposedAt:h.pendingPayer.proposedAt,acceptedAt:now(),authorization:'studio-balance responsibility, accepted by the payer signed in',storedMethod:null};
  tx.put('householdPayerChange',change);
  return put(tx,h,{payerId:tx.who.personId,pendingPayer:null},tx.who.personId);
}

/** What each person may read of households: their own, never another's. Contacts go to staff and guardians only. */
export function householdSnapshot(state: State, who: Actor) {
  const owner = who.role === 'owner' || who.role === 'agent', me = who.personId;
  const name = (personId: string) => state.people.find(p => p.id === personId)?.name ?? 'Former member';
  return households(state).filter(h => owner || (me && (h.guardianIds.includes(me) || h.participantIds.includes(me) || h.payerId === me || h.pendingPayer?.personId === me))).map(h => {
    const guardian = !!me && h.guardianIds.includes(me), payer = !!me && h.payerId === me, pending = !!me && h.pendingPayer?.personId === me;
    const full = owner || guardian;
    return {id:h.id,name:h.name,revision:h.revision,role:owner ? 'staff' : guardian ? 'guardian' : payer ? 'payer' : pending ? 'proposed payer' : 'participant',
      guardians:full || payer ? h.guardianIds.map((g: string) => ({id:g,name:name(g)})) : [],participants:full || payer || pending ? h.participantIds.map((p: string) => ({id:p,name:name(p)})) : (me ? [{id:me,name:name(me)}] : []),
      contacts:full ? h.contacts : [],payer:h.payerId && (full || payer || me && h.participantIds.includes(me)) ? {id:h.payerId,name:name(h.payerId)} : null,
      pendingPayer:h.pendingPayer && (owner || pending || guardian) ? {personId:h.pendingPayer.personId,name:name(h.pendingPayer.personId),proposedAt:h.pendingPayer.proposedAt} : null,
      ...(owner ? {guardianEvidence:h.guardianEvidence,removedGuardians:h.removedGuardians ?? []} : {})};
  });
}

import { humanOwner, id, insist, integer, list, now, person, text, type Actor, type Person, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { memberCheckin, phoneDigits, savePhone } from './checkin';
import { requireMemberRecord } from './member-records';
import { requestBasis, staffChannel } from './staff-actions';

// APP-003: a member's profile is their name and sign-in email (st_people), the
// 10-digit US mobile on the ATT-001 check-in record and one emergency contact.
// The email stays an owner-only identity change (person.save). Every door that
// changes a profile writes one profileChange entry with actor, channel and the
// before and after values; staff-made entries are the canonical STAFF-006 audit.
const profileId = (personId: string) => `member-profile:${personId}`;
const fields = ['name', 'email', 'phone', 'emergencyContact'] as const;
type Profile = { name: string; email: string | null; phone: string | null; emergencyContact: { name: string; phone: string; relationship: string | null } | null };
type Door = { command: string; channel: string; staffMade: boolean; requestId?: string; requestBasis?: string };

export const memberProfile = (state: State, personId: string) => state.records.get(profileId(personId))?.data ?? null;
export const profileOf = (state: State, member: Person): Profile => ({
  name: member.name, email: member.email, phone: memberCheckin(state, member.id)?.phone ?? null,
  emergencyContact: memberProfile(state, member.id)?.emergencyContact ?? null,
});

function optional(value: unknown, field: string, max: number) {
  if (value === null) return null;
  insist(typeof value === 'string' && value.trim().length <= max, `invalid_${field}`);
  return value.trim() || null;
}
/** Absent contact fields keep their value; clearing the name and phone removes the contact. */
function contactFrom(input: Record<string, unknown>, current: Profile['emergencyContact']) {
  if (['emergencyName', 'emergencyPhone', 'emergencyRelationship'].every(key => input[key] === undefined)) return current;
  const pick = (key: string, stored: string | null | undefined) => input[key] === undefined ? stored ?? null : input[key];
  const name = optional(pick('emergencyName', current?.name), 'emergencyName', 160);
  const relationship = optional(pick('emergencyRelationship', current?.relationship), 'emergencyRelationship', 60);
  const raw = optional(pick('emergencyPhone', current?.phone), 'emergencyPhone', 20);
  if (!name && !raw && !relationship) return null;
  insist(name && raw, 'emergency_contact_needs_name_and_phone');
  const digits = raw!.replace(/[\s().+-]/g, '');
  insist(/^1?\d{10}$/.test(digits), 'invalid_emergencyPhone');
  return { name: name!, phone: digits.slice(-10), relationship };
}

/** Records one change; a request that would change nothing is refused before any write. */
export function recordProfileChange(tx: Transaction, member: Person, before: Profile, after: Profile, door: Door) {
  const changed = fields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  insist(changed.length > 0, 'profile_unchanged', 409);
  const revision = (memberProfile(tx.state, member.id)?.revision ?? 0) + 1, at = now();
  tx.put('memberProfile', { id: profileId(member.id), personId: member.id, emergencyContact: after.emergencyContact, revision, updatedAt: at, updatedBy: tx.who.id });
  const result = { personId: member.id, ...after, revision };
  tx.put('profileChange', { id: id(), action: door.command, command: door.command, personId: member.id, revision, actorId: tx.who.id, actorRole: tx.who.role,
    staffMade: door.staffMade, right: door.staffMade ? 'member-record' : null, channel: door.channel, changed, before, after, reason: null, at,
    ...(door.requestId ? { requestId: door.requestId, requestBasis: door.requestBasis, result } : {}) });
  return result;
}

function applyProfile(tx: Transaction, member: Person, input: Record<string, unknown>, door: Door) {
  const requestId = text(input.requestId, 'requestId', 100), basis = requestBasis(input);
  // The staff door's replay is answered by the shared STAFF-006 request check.
  const prior = door.staffMade ? null : list(tx.state, 'profileChange').find(c => c.actorId === tx.who.id && c.requestId === requestId);
  if (prior) { insist(prior.command === door.command && prior.requestBasis === basis, 'profile_request_changed', 409); return structuredClone(prior.result); }
  const revision = memberProfile(tx.state, member.id)?.revision ?? 0;
  if (input.revision !== undefined) insist(integer(input.revision, 'revision', 0, Number.MAX_SAFE_INTEGER) === revision, 'profile_changed', 409);
  const before = profileOf(tx.state, member);
  const after: Profile = { name: input.name === undefined ? before.name : text(input.name, 'name', 160), email: before.email,
    phone: input.phone === undefined ? before.phone : phoneDigits(input.phone), emergencyContact: contactFrom(input, before.emergencyContact) };
  const result = recordProfileChange(tx, member, before, after, { ...door, requestId, requestBasis: basis });
  if (after.name !== before.name) tx.sql.push(tx.statement('UPDATE st_people SET name=?,version=version+1 WHERE id=? AND erased_at IS NULL', after.name, member.id));
  if (after.phone !== before.phone) savePhone(tx, member.id, after.phone ?? '');
  return result;
}

/** The signed-in member edits only their own name, phone and emergency contact. */
export function saveOwnProfile(tx: Transaction, input: Record<string, unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId, 'member_required', 403);
  const member = person(tx.state, tx.who.personId);
  insist(member.role === 'member', 'member_required', 403);
  insist(input.personId === undefined || input.personId === member.id, 'own_profile_required', 403);
  insist(input.email === undefined, 'sign_in_email_is_owner_managed', 403);
  return applyProfile(tx, member, input, { command: 'profile.save', channel: 'self', staffMade: false });
}

/** The member-record staff door (the owner until STAFF-001): the same fields and fences. */
export function saveMemberProfile(tx: Transaction, input: Record<string, unknown>) {
  requireMemberRecord(tx.state,tx.who,input.personId);
  insist(input.email === undefined, 'sign_in_email_is_changed_in_access_settings');
  const member = person(tx.state, input.personId, false);
  insist(member.role === 'member', 'member_required');
  return applyProfile(tx, member, input, { command: 'profile.save.staff', channel: staffChannel(input), staffMade: true });
}

/** Owners (and their preparation keys) read every profile; a member reads only their own. */
export function profileSnapshot(state: State, who: Actor) {
  const owner = who.role === 'owner' || who.role === 'agent';
  const changes = list(state, 'profileChange').filter(c => owner || (who.role === 'member' && c.personId === who.personId));
  return changes.map((c: RecordData) => { const { requestBasis: _basis, result: _result, ...entry } = c; return entry; }).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

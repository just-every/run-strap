import { placeId } from './locations';
import type { Transaction } from './store';
import { humanOwner, id, insist, list, now, person, type Actor, type RecordData, type State } from './types';

export const STAFF_RIGHTS = ['booking','override','fee-waiver','check-in','sale','price','membership-sale','collection','refund','contract-change','member-record','privacy','sensitive-notes','exports','campaigns','staff-pay'] as const;
export const STAFF_ROLES = ['manager','front-desk','finance','instructor'] as const;
export const STAFF_DOORS = ['all','appointment','attendance-plan','retail','member-record'] as const;
export type StaffRight = typeof STAFF_RIGHTS[number];
export type StaffRole = typeof STAFF_ROLES[number];
export type StaffDoor = typeof STAFF_DOORS[number] | 'class';
export interface StaffScope { memberIds: string[]; locationIds: string[]; doors: StaffDoor[] }
export interface StaffPermission { enabled: boolean; scopes: StaffScope[]; canCreate?: boolean; version?: number }
export interface StaffAccess extends RecordData {
  personId: string; role: StaffRole; enabled: boolean; version: number;
  rights: Partial<Record<StaffRight,StaffPermission>>;
  legacyGrants?: Partial<Record<LegacyStaffDoor,RecordData>>;
}
const allowed: Record<StaffRole,readonly StaffRight[]> = {
  manager: STAFF_RIGHTS.filter(right => right !== 'privacy'),
  'front-desk': STAFF_RIGHTS.filter(right => !['privacy','price','staff-pay'].includes(right)),
  finance: ['collection','refund','exports','staff-pay'],
  instructor: ['booking','check-in','member-record','sensitive-notes','staff-pay'],
};
export const staffRoleAllows = (role: StaffRole, right: StaffRight) => allowed[role]?.includes(right) === true;
export function staffAccess(state: State, who: Pick<Actor,'personId'>): StaffAccess | null {
  const row = who.personId ? state.records.get(`staff-access:${who.personId}`) : null;
  return row?.kind === 'staffAccess' && row.data.personId === who.personId ? row.data as StaffAccess : null;
}
export const staffAccessRecords = (state: State): StaffAccess[] => list(state,'staffAccess') as StaffAccess[];
export function staffRoleFromAccess(state: State, who: Pick<Actor,'personId'>): StaffRole | null {
  const access = staffAccess(state,who), staff = state.people.find(p => p.id === who.personId && p.active && !p.erasedAt && p.email);
  return access?.enabled && staff && STAFF_ROLES.includes(access.role)
    && staff.role === (access.role === 'instructor' ? 'instructor' : 'member') ? access.role : null;
}
function authorizedPermission(state: State, who: Actor, right: StaffRight) {
  const access = staffAccess(state,who), staff = state.people.find(p => p.id === who.personId);
  return staffRoleFromAccess(state,who) === who.role
    && access && staffRoleAllows(access.role,right) && access.rights?.[right]?.enabled === true ? access.rights[right] : null;
}
export function hasStaffRight(state: State, who: Actor, right: StaffRight, personId?: unknown, locationId?: unknown, door: StaffDoor = 'all'): boolean {
  if (who.role === 'owner' && who.isOwner) return true;
  const permission = authorizedPermission(state,who,right);
  return !!permission && Array.isArray(permission.scopes) && permission.scopes.some(scope =>
    Array.isArray(scope.doors) && (scope.doors.includes('all') || scope.doors.includes(door))
    && (personId === undefined || Array.isArray(scope.memberIds) && scope.memberIds.includes(personId as string))
    && (locationId === undefined || Array.isArray(scope.locationIds) && scope.locationIds.includes(locationId as string)));
}
export function requireStaffRight(state: State, who: Actor, right: StaffRight, personId?: unknown, locationId?: unknown, door: StaffDoor = 'all') {
  if (who.role === 'owner' && who.isOwner) return;
  insist(authorizedPermission(state,who,right),'staff_right_required',403);
  insist(hasStaffRight(state,who,right,personId,locationId,door),'staff_scope_required',403);
}
export function staffMemberIds(state: State, values: unknown): string[] {
  insist(Array.isArray(values) && values.length <= 500,'invalid_member_scope');
  return [...new Set(values.map(value => { const member = person(state,value,false); insist(member.role === 'member','member_required'); return member.id; }))].sort();
}
export function staffLocationIds(state: State, values: unknown): string[] {
  insist(Array.isArray(values) && values.length <= 100,'invalid_location_scope');
  return [...new Set(values.map(value => { insist(typeof value === 'string','invalid_location_scope'); return placeId(state,value); }))].sort();
}
export async function staffIdentity(tx: Transaction, personId: unknown, role: StaffRole) {
  const staff = person(tx.state,personId);
  insist(staff.email && staff.role === (role === 'instructor' ? 'instructor' : 'member'),'member_staff_identity_required');
  insist(!await tx.db.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=lower(?) AND role='owner'").bind(staff.email).first(),'owner_identity_cannot_be_staff',409);
  return staff;
}
function saveAccess(tx: Transaction, before: StaffAccess | null, value: Pick<StaffAccess,'personId'|'role'|'enabled'|'rights'> & Partial<StaffAccess>) {
  const saved = {...value,id:`staff-access:${value.personId}`,version:(before?.version ?? 0)+1,updatedAt:now(),updatedBy:tx.who.id} as StaffAccess;
  tx.put('staffAccess',saved);
  tx.put('staffAccessEvent',{id:id(),personId:saved.personId,before:before ?? null,after:saved,version:saved.version,at:saved.updatedAt,actorId:tx.who.id});
  return saved;
}
export async function grantStaffAccess(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(STAFF_ROLES.includes(input.role as StaffRole),'invalid_staff_role');
  const role = input.role as StaffRole, staff = await staffIdentity(tx,input.personId,role);
  insist(typeof input.enabled === 'boolean' && input.rights && typeof input.rights === 'object' && !Array.isArray(input.rights),'invalid_staff_grant');
  const before = staffAccess(tx.state,{personId:staff.id}), rights: StaffAccess['rights'] = {};
  for (const [key,raw] of Object.entries(input.rights as Record<string,unknown>)) {
    insist(STAFF_RIGHTS.includes(key as StaffRight),'invalid_staff_right');
    const right = key as StaffRight, grant = raw as StaffPermission;
    insist(grant && typeof grant === 'object' && typeof grant.enabled === 'boolean' && Array.isArray(grant.scopes) && grant.scopes.length <= 100,'invalid_staff_grant');
    insist(!grant.enabled || staffRoleAllows(role,right),'staff_role_right_forbidden');
    insist(grant.canCreate === undefined || right === 'member-record' && typeof grant.canCreate === 'boolean','invalid_staff_grant');
    const scopes = grant.scopes.map(scope => {
      insist(scope && typeof scope === 'object' && Array.isArray(scope.doors) && scope.doors.length === 1 && scope.doors[0] === 'all','invalid_staff_door');
      return {memberIds:staffMemberIds(tx.state,scope.memberIds),locationIds:staffLocationIds(tx.state,scope.locationIds),doors:['all'] as StaffDoor[]};
    });
    rights[right] = {enabled:grant.enabled,scopes,version:(before?.rights?.[right]?.version ?? 0)+1,...(right === 'member-record' ? {canCreate:grant.canCreate === true} : {})};
  }
  return saveAccess(tx,before,{personId:staff.id,role,enabled:input.enabled,rights,...(before?.legacyGrants ? {legacyGrants:before.legacyGrants} : {})});
}

const legacyKinds = {'member-record':'memberRecordGrant',appointment:'appointmentBookingGrant','attendance-plan':'attendanceBookingGrant',retail:'retailStaffGrant'} as const;
const legacyIds = {'member-record':'member-record-grant:',appointment:'appointment-booking-grant:','attendance-plan':'attendance-booking-grant:',retail:'retail-staff:'} as const;
export type LegacyStaffDoor = keyof typeof legacyKinds;
function doorPermission(access: StaffAccess, right: StaffRight, door: LegacyStaffDoor) {
  const grant = access.rights?.[right];
  const scopes = grant?.scopes?.filter(scope => scope.doors.includes('all') || scope.doors.includes(door)) ?? [];
  return {grant,scopes,enabled:access.enabled && staffRoleAllows(access.role,right) && grant?.enabled === true && scopes.length > 0};
}
/** Compatibility views expose current canonical authority; old inputs retain disabled edit fields only. */
export function legacyStaffGrant(state: State, who: Pick<Actor,'personId'>, door: LegacyStaffDoor): RecordData | null {
  const access = staffAccess(state,who); if (!access) return null;
  const old = access.legacyGrants?.[door], right = door === 'member-record' ? 'member-record' : door === 'retail' ? 'sale' : 'booking';
  const current = doorPermission(access,right,door), refund = doorPermission(access,'refund',door);
  const scopes = door === 'retail' ? [...current.scopes,...refund.scopes] : current.scopes;
  if (!old && scopes.length === 0) return null;
  return {...old,id:legacyIds[door]+access.personId,personId:access.personId,
    enabled:door === 'retail' ? current.enabled || refund.enabled : current.enabled,
    memberIds:scopes.length ? [...new Set(scopes.flatMap(scope => scope.memberIds))].sort() : old?.memberIds ?? [],
    ...(door !== 'member-record' ? {locationIds:scopes.length ? [...new Set(scopes.flatMap(scope => scope.locationIds))].sort() : old?.locationIds ?? []} : {}),
    ...(door === 'member-record' ? {canCreate:current.grant?.canCreate === true} : {}),
    ...(door === 'retail' ? {sale:current.enabled,refund:refund.enabled} : {}),
    version:Math.max(old?.version ?? 0,current.grant?.version ?? 0,door === 'retail' ? refund.grant?.version ?? 0 : 0),updatedAt:access.updatedAt,updatedBy:access.updatedBy};
}
export function legacyStaffGrants(state: State, kind: typeof legacyKinds[LegacyStaffDoor]) {
  const door = (Object.keys(legacyKinds) as LegacyStaffDoor[]).find(value => legacyKinds[value] === kind)!;
  return staffAccessRecords(state).flatMap(access => {const view = legacyStaffGrant(state,{personId:access.personId},door); return view ? [view] : [];});
}
/** A legacy change replaces common scope and its own door while retaining other exact doors. */
export function updateLegacyStaffAccess(tx: Transaction, door: LegacyStaffDoor, input: RecordData) {
  const before = staffAccess(tx.state,{personId:input.personId});
  const rights: StaffAccess['rights'] = structuredClone(before?.rights ?? {});
  if (before && !before.enabled) for (const right of Object.values(rights)) if (right) { right.enabled = false; right.scopes = []; }
  const role = before?.role ?? 'front-desk';
  const changes: [StaffRight,boolean][] = door === 'retail' ? [['sale',input.enabled && input.sale],['refund',input.enabled && input.refund]]
    : [[door === 'member-record' ? 'member-record' : 'booking',input.enabled]];
  for (const [right,enabled] of changes) {
    insist(!enabled || staffRoleAllows(role,right),'staff_role_right_forbidden');
    const prior = rights[right], scopes = (prior?.enabled ? prior.scopes : []).filter(scope => !scope.doors.includes('all') && !scope.doors.includes(door));
    if (enabled) scopes.push({memberIds:input.memberIds,locationIds:input.locationIds ?? [],doors:[door]});
    rights[right] = {enabled:scopes.length > 0,scopes,version:(prior?.version ?? 0)+1,
      ...(right === 'member-record' ? {canCreate:input.canCreate === true} : {})};
  }
  const old = legacyStaffGrant(tx.state,{personId:input.personId},door);
  const metadata = {...input,version:(old?.version ?? 0)+1};
  const saved = saveAccess(tx,before,{personId:input.personId,role,enabled:Object.values(rights).some(right => right?.enabled),rights,
    legacyGrants:{...before?.legacyGrants,[door]:metadata}});
  return legacyStaffGrant(tx.state,{personId:saved.personId},door)!;
}
/** A newly created record joins only the creator's existing member-record scopes. */
export function extendStaffMemberScope(tx: Transaction, memberId: string) {
  const before = staffAccess(tx.state,tx.who); insist(before,'staff_right_required',403);
  const grant = before.rights['member-record']; insist(grant?.enabled && grant.canCreate,'member_record_create_right_required',403);
  const rights = {...before.rights,'member-record':{...grant,version:(grant.version ?? 0)+1,scopes:grant.scopes.map(scope => ({...scope,memberIds:[...new Set([...scope.memberIds,memberId])].sort()}))}};
  return saveAccess(tx,before,{...before,rights});
}

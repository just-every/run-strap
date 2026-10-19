import { humanOwner, id, instant, integer, insist, list, now, person, record, text, type RecordData } from './types';
import type { Transaction } from './store';

type ResourceKind = 'instructor' | 'room' | 'equipment';
interface Resource { kind: ResourceKind; id: string; label: string }
export interface SchedulingConflict {
  classId: string; classTitle: string; resource: Resource;
  record: RecordData; recordKind: 'class' | 'unavailability';
  occupiedStart: string; occupiedEnd: string;
}

// One studio owns the resource namespace. Labels retain readable casing, while
// identity ignores case and repeated whitespace (including imported room names).
export const resourceLabel = (value: string) => value.trim().replace(/\s+/g, ' ');
const resourceKey = (value: string) => resourceLabel(value).toLowerCase();
export const roomOf = (c: RecordData): string => c.room ?? String(c.title ?? '').split(' · ').slice(1).join(' · ');

export function classResources(c: RecordData): Resource[] {
  return [
    {kind:'instructor' as const,id:c.instructorId,label:c.instructorName ?? c.instructorId},
    ...(roomOf(c) ? [{kind:'room' as const,id:resourceKey(roomOf(c)),label:roomOf(c)}] : []),
    ...(c.equipment ?? []).map((label: string) => ({kind:'equipment' as const,id:resourceKey(label),label})),
  ];
}

export function schedulingFields(entry: Record<string, unknown>) {
  const room = entry.room === undefined || entry.room === '' ? '' : resourceLabel(text(entry.room,'room',100));
  const equipment = entry.equipment ?? [];
  insist(Array.isArray(equipment) && equipment.length <= 100,'invalid_equipment');
  const names = equipment.map(value => resourceLabel(text(value,'equipment',100)));
  return {room,equipment:[...new Map(names.map(label => [resourceKey(label),label])).values()],
    bufferBeforeMinutes:integer(entry.bufferBeforeMinutes ?? 0,'buffer_before_minutes',0,1440),
    bufferAfterMinutes:integer(entry.bufferAfterMinutes ?? 0,'buffer_after_minutes',0,1440)};
}

/** UTC, half-open [start - preparation, end + cleanup): touching is allowed. */
export function occupiedInterval(c: RecordData): [number, number] {
  return [Date.parse(c.start) - (c.bufferBeforeMinutes ?? 0) * 60_000,Date.parse(c.end) + (c.bufferAfterMinutes ?? 0) * 60_000];
}
const overlaps = (a: [number,number], b: [number,number]) => a[0] < b[1] && b[0] < a[1];
const sameResource = (a: Resource, b: Resource) => a.kind === b.kind && a.id === b.id;
const unavailableResource = (r: RecordData): Resource => ({kind:r.resourceKind,id:r.resourceKind === 'instructor' ? r.resourceId : resourceKey(r.resourceId),label:r.resourceName});

/** Used both before writes and on the owner's live draft review. */
export function schedulingConflicts(classes: RecordData[], published: RecordData[], unavailable: RecordData[]): SchedulingConflict[] {
  const conflicts: SchedulingConflict[] = [], seen = new Set<string>();
  for (const candidate of classes) {
    const interval = occupiedInterval(candidate), resources = classResources(candidate);
    const others: {record:RecordData;kind:'class'|'unavailability';resources:Resource[];interval:[number,number]}[] = [...published,...classes.filter(c => c.id !== candidate.id)].map(c => ({record:c,kind:'class',resources:classResources(c),interval:occupiedInterval(c)}));
    others.push(...unavailable.filter(r => r.status === 'active').map(r => ({record:r,kind:'unavailability' as const,resources:[unavailableResource(r)],interval:[Date.parse(r.start),Date.parse(r.end)] as [number,number]})));
    for (const other of others) {
      if (!overlaps(interval,other.interval)) continue;
      for (const resource of resources.filter(r => other.resources.some(o => sameResource(r,o)))) {
        const key = [...[candidate.id,other.record.id].sort(),resource.kind,resource.id].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({classId:candidate.id,classTitle:candidate.title,resource,record:other.record,recordKind:other.kind,
          occupiedStart:new Date(other.interval[0]).toISOString(),occupiedEnd:new Date(other.interval[1]).toISOString()});
      }
    }
  }
  return conflicts;
}

export function refuseSchedulingConflicts(conflicts: SchedulingConflict[], includeReasons = true) {
  insist(!conflicts.length,`Scheduling conflict: ${conflicts.map(c => `${c.classTitle} [${c.classId}] — ${c.resource.kind} ${c.resource.label}: ${c.recordKind === 'class' ? c.record.title : includeReasons ? c.record.reason : 'Unavailable'} [${c.record.id}], ${c.occupiedStart} to ${c.occupiedEnd}`).join('; ')}`,409);
}

export function saveUnavailability(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const previous = input.id ? record(tx.state,input.id,'unavailability') : null;
  const kind = text(input.resourceKind,'resource_kind');
  insist(['instructor','room','equipment'].includes(kind),'invalid_resource_kind');
  const resourceId = kind === 'instructor' ? person(tx.state,input.resourceId).id : resourceLabel(text(input.resourceId,'resource',100));
  const instructor = kind === 'instructor' ? person(tx.state,resourceId) : null;
  insist(!instructor || instructor.role === 'instructor','instructor_required');
  const entry = {id:previous?.id ?? id(),resourceKind:kind,resourceId,resourceName:instructor?.name ?? resourceId,
    start:instant(input.start,'start'),end:instant(input.end,'end'),reason:text(input.reason,'reason',300),status:'active',
    createdAt:previous?.createdAt ?? now(),createdBy:previous?.createdBy ?? tx.who.id,updatedAt:now(),updatedBy:tx.who.id};
  insist(entry.end > entry.start,'unavailability_end_must_follow_start');
  // An exception cannot silently invalidate an already-published allocation.
  refuseSchedulingConflicts(list(tx.state,'class').filter(c => c.status !== 'cancelled').flatMap(c => schedulingConflicts([c],[],[entry])));
  tx.put('unavailability',entry); return entry;
}

export function removeUnavailability(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const entry = record(tx.state,input.id,'unavailability');
  insist(entry.status === 'active','unavailability_already_removed',409);
  const removed = {...entry,status:'removed',removedAt:now(),removedBy:tx.who.id};
  tx.put('unavailability',removed); return removed;
}

export interface Actor {
  id: string; email: string; role: 'owner' | 'instructor' | 'member' | 'agent' | 'kiosk' | 'system';
  personId?: string; isOwner: boolean; kioskId?: string;
}
export interface Person {
  id: string; name: string; email: string | null; role: 'member' | 'instructor';
  active: boolean; version: number; erasedAt: number | null;
}
// Records are JSON documents; every write is fenced by the shared domain revision.
export type RecordData = { id: string; [key: string]: any };
export interface State {
  version: number; people: Person[]; records: Map<string, { kind: string; data: RecordData }>;
  operator: { id: string; email: string; role: string; status: string; version: number };
}
export class DomainError extends Error {
  constructor(public code: string, public status = 400) { super(code); this.name = 'DomainError'; }
}
export function insist(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new DomainError(code, status);
}
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function text(value: unknown, field: string, max = 200): string {
  insist(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `invalid_${field}`);
  return value.trim();
}
export function integer(value: unknown, field: string, min = 1, max = 1_000_000): number {
  insist(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, `invalid_${field}`);
  return value;
}
export function instant(value: unknown, field: string): string {
  const input = text(value, field, 50);
  insist(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(input) && Number.isFinite(Date.parse(input)), `invalid_${field}`);
  const [year,month,day] = input.slice(0,10).split('-').map(Number);
  insist(new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10) === input.slice(0,10),`invalid_${field}`);
  return new Date(input).toISOString();
}
export const list = (state: State, kind: string) => [...state.records.values()].filter(row => row.kind === kind).map(row => row.data);
export function record(state: State, key: unknown, kind: string): RecordData {
  const row = state.records.get(text(key, 'id', 100));
  insist(row?.kind === kind, `${kind}_not_found`, 404);
  return row.data;
}
export function person(state: State, key: unknown, active = true): Person {
  const found = state.people.find(row => row.id === key && !row.erasedAt && (!active || row.active));
  insist(found, 'person_not_found', 404); return found;
}
export const humanOwner = (who: Actor) => insist(who.role === 'owner' && who.isOwner, 'owner_required', 403);
export const preparer = (who: Actor) => insist(who.isOwner && ['owner', 'agent'].includes(who.role), 'owner_required', 403);

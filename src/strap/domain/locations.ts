import { humanOwner, id, insist, list, now, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { isZone } from '../zone';
import { phoneDigits } from './phone';
import { studioProfile } from './studio-profile';
import { studioSettings } from './studio';

/** STUDIO-001/002: the studio's own record is the original location; later ones are 'location' records.
 * Classes, packs, closures and keys without a location id belong to the original. */
export const ORIGINAL_LOCATION = 'studio';
export interface Location {
  id: string; name: string; timeZone: string; address: RecordData | null; phone: string | null;
  businessHours: RecordData[]; original: boolean;
}
export function locations(state: State): Location[] {
  const studio = studioSettings(state);
  const original: Location[] = studio ? [{id:ORIGINAL_LOCATION,name:studio.location,timeZone:studio.timeZone,address:studio.address ?? null,phone:studio.phone ?? null,businessHours:studio.businessHours ?? [],original:true}] : [];
  return [...original,...list(state,'location').sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map(l => ({id:l.id,name:l.name,timeZone:l.timeZone,address:l.address ?? null,phone:l.phone ?? null,businessHours:l.businessHours ?? [],original:false}))];
}
export const locationOf = (entry: RecordData | undefined | null): string => entry?.locationId ?? ORIGINAL_LOCATION;
export function locationById(state: State, key: unknown): Location {
  const found = locations(state).find(l => l.id === key);
  insist(found,'location_not_found',404); return found;
}
/** The clock of the class's own location (classes made before locations kept the studio's). */
export const classZone = (state: State, entry: RecordData): string => entry.timeZone ?? studioSettings(state)?.timeZone ?? 'UTC';

const same = (a: string, b: string) => a.trim().replace(/\s+/g,' ').toLowerCase() === b.trim().replace(/\s+/g,' ').toLowerCase();
export function saveLocation(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(studioSettings(tx.state),'studio_settings_required',409);
  const current = input.id === undefined || input.id === '' ? null : record(tx.state,input.id,'location');
  const name = text(input.name,'location_name',80);
  insist(isZone(input.timeZone),'invalid_time_zone');
  insist(!locations(tx.state).some(l => l.id !== current?.id && same(l.name,name)),'location_name_used',409);
  if (current && current.timeZone !== input.timeZone) insist(!list(tx.state,'class').some(c => locationOf(c) === current.id),'location_has_classes',409);
  const profile = studioProfile(input);
  const saved = {...current,...profile,id:current?.id ?? id(),name,timeZone:input.timeZone,
    ...('phone' in input ? {phone:phoneDigits(input.phone)} : {phone:current?.phone ?? null}),
    createdAt:current?.createdAt ?? now(),createdBy:current?.createdBy ?? tx.who.id,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('location',saved); return saved;
}

/** A location id from input; the original needs no studio record until the studio saves one. */
export function placeId(state: State, key: unknown): string {
  return key === undefined || key === ORIGINAL_LOCATION ? ORIGINAL_LOCATION : locationById(state,key).id;
}
/** PLAN-007-style explicit terms: a pack names 'all' locations or the ones it is valid at; absent means its sale location only. */
export function packPlaces(state: State, input: Record<string,unknown>): {locationId: string; eligibleLocations: 'all' | string[]} {
  const locationId = placeId(state,input.locationId), value = input.eligibleLocations;
  if (value === undefined) return {locationId,eligibleLocations:[locationId]};
  if (value === 'all') return {locationId,eligibleLocations:'all'};
  insist(Array.isArray(value) && value.length >= 1 && value.length <= 50,'invalid_eligibleLocations');
  return {locationId,eligibleLocations:[...new Set(value.map(v => placeId(state,v)))].sort()};
}
/** Plans made before locations existed are valid at the original location only. */
export const packLocationEligible = (pack: RecordData, entry: RecordData) => {
  const places = pack.eligibleLocations ?? [ORIGINAL_LOCATION];
  return places === 'all' || places.includes(locationOf(entry));
};

/** A class as every screen reads it: classes made before locations existed sit at the original location on its clock. */
export function placed(state: State, entry: RecordData) {
  const studio = studioSettings(state);
  return {locationId:locationOf(entry),location:entry.location ?? studio?.location ?? null,timeZone:classZone(state,entry)};
}

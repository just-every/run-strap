import { humanOwner, insist, list, now, text, type State } from './types';
import type { Transaction } from './store';
import { isZone } from '../zone';
import { studioProfile } from './studio-profile';

// One studio configuration record; partial updates retain existing profile fields.
export const studioSettings = (state: State) => list(state,'studio').at(-1) ?? null;

export function saveStudio(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(isZone(input.timeZone),'invalid_time_zone');
  const settings = {...studioSettings(tx.state),...studioProfile(input),id:'studio',location:text(input.location,'location',80),timeZone:input.timeZone,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('studio',settings); return settings;
}

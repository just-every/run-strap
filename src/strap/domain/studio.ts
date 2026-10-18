import { humanOwner, insist, list, now, text, type State } from './types';
import type { Transaction } from './store';
import { isZone } from '../zone';

// The studio's own settings: the location name people see and the IANA time
// zone every class time is entered and read in. One record, replaced on save.
export const studioSettings = (state: State) => list(state,'studio').at(-1) ?? null;

export function saveStudio(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(isZone(input.timeZone),'invalid_time_zone');
  const settings = {id:'studio',location:text(input.location,'location',80),timeZone:input.timeZone,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('studio',settings); return settings;
}

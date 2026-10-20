import { humanOwner, id, insist, list, now, person, text, type RecordData, type State } from './types';
import type { Transaction } from './store';

export function messagePreference(state: State, personId: string) {
  return state.records.get(`message-preference:${personId}`)?.data ?? {
    id:`message-preference:${personId}`,personId,optedOut:false,updatedAt:null,updatedBy:null,
  };
}

export function messageTemplates(state: State) {
  return state.records.get('message-templates')?.data ?? {id:'message-templates',prefix:'',suffix:'',updatedAt:null,updatedBy:null};
}

function request(tx: Transaction, input: Record<string,unknown>, command: string) {
  const requestId = text(input.requestId,'requestId',100);
  const basis = JSON.stringify(Object.keys(input).sort().map(key => [key,input[key]]));
  const prior = ['messagePreferenceEvent','messageTemplateEvent','messagePreferenceLaunch']
    .flatMap(kind => list(tx.state,kind)).find(event => event.actorId === tx.who.id && event.requestId === requestId);
  if (prior) insist(prior.command === command && prior.requestBasis === basis,'message_request_changed',409);
  return {requestId,requestBasis:basis,command,actorId:tx.who.id,actorRole:tx.who.role,prior};
}

/** This setting belongs exclusively to the native member whose session acts. */
export function saveMessagePreference(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const member = person(tx.state,tx.who.personId);
  insist(member.role === 'member','member_required',403);
  insist(input.personId === undefined || input.personId === member.id,'own_preference_required',403);
  insist(input.id === undefined || input.id === `message-preference:${member.id}`,'own_preference_required',403);
  insist(typeof input.optedOut === 'boolean','invalid_optedOut');
  const {prior,...req} = request(tx,input,'mail.preference.save');
  if (prior) return structuredClone(prior.after);
  const before = structuredClone(messagePreference(tx.state,member.id));
  const after = {...before,optedOut:input.optedOut,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('messagePreference',after);
  tx.put('messagePreferenceEvent',{id:id(),...req,personId:member.id,before,after:structuredClone(after),at:after.updatedAt,source:'member_session'});
  return after;
}

function templatePart(value: unknown, field: string) {
  insist(typeof value === 'string' && value.length <= 500,`invalid_${field}`);
  return value;
}

/** Plain text is retained verbatim; it is never interpreted as a template. */
export function saveMessageTemplates(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const prefix = templatePart(input.prefix,'prefix'), suffix = templatePart(input.suffix,'suffix');
  const {prior,...req} = request(tx,input,'mail.templates.save');
  if (prior) return structuredClone(prior.after);
  const before = structuredClone(messageTemplates(tx.state));
  const after = {id:'message-templates',prefix,suffix,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('messageTemplates',after);
  tx.put('messageTemplateEvent',{id:id(),...req,before,after:structuredClone(after),at:after.updatedAt});
  return after;
}

/** Opening this ordinary door grants no authority and changes no preference. */
export function launchMessagePreference(tx: Transaction, input: Record<string,unknown>): RecordData {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId);
  insist(member.role === 'member','member_required');
  const {prior,...req} = request(tx,input,'mail.preference.launch');
  if (prior) return structuredClone(prior);
  const launch = {id:id(),...req,personId:member.id,preferenceDoor:true,
    url:'/signin?returnTo=%2Fapp%23message-preferences',status:'member_action_required',createdAt:now(),createdBy:tx.who.id};
  tx.put('messagePreferenceLaunch',launch);
  return launch;
}

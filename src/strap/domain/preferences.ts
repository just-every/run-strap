import { insist, integer, list, now, person, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { messagePreference, saveMessagePreference } from './message-settings';
import { requireMemberRecord } from './member-records';
import { staffChannel } from './staff-actions';

export const channels = ['email','sms','inApp'] as const;
export type MarketingChannel = typeof channels[number];
export function preferencesOf(state: State,personId: string): RecordData {
  return state.records.get('member-preference:'+personId)?.data ?? {id:'member-preference:'+personId,personId,revision:0,
    marketing:{email:'denied',sms:'denied',inApp:'denied'},contactChannels:{email:true,sms:false,inApp:true},preferredTimes:'',preferredClasses:'',accessibility:'',
    attendanceSharing:true,feedback:false,timeZone:'America/New_York',quietStart:'20:00',quietEnd:'10:00',updatedAt:null,updatedBy:null,source:null};
}
export function suppressMarketing(tx: Transaction,personId: string,channel: string | null,reason: string) {
  for(const message of list(tx.state,'marketingMessage').filter(m => m.personId === personId && (!channel || m.channel === channel) && ['queued','held'].includes(m.status)))
    tx.put('marketingMessage',{...message,status:'suppressed',suppressionReason:reason,suppressedAt:now()});
}
export function permission(state: State,personId: string,channel: MarketingChannel) {
  const p=preferencesOf(state,personId);
  if (!state.people.some(member => member.id === personId && member.active && !member.erasedAt)) return 'member_inactive';
  if (p.marketing[channel] !== 'confirmed') return p.marketing[channel] === 'pending' ? 'reply_confirmation_pending' : 'permission_denied';
  if (state.records.get(`marketing-suppression:${personId}:${channel}`)?.data.active) return 'provider_suppressed';
  return null;
}
const optional = (value: unknown,key: string,max: number) => {insist(typeof value === 'string' && value.trim().length <= max,'invalid_'+key);return value.trim();};
const clock = (value: unknown,key: string) => {insist(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value),'invalid_'+key);return value;};
function save(tx: Transaction,input: Record<string,unknown>,staff: boolean) {
  const memberId=staff ? input.personId : tx.who.personId;
  if(staff)requireMemberRecord(tx.state,tx.who,memberId);
  else {insist(tx.who.role === 'member','member_required',403);insist(input.personId === undefined || input.personId === memberId,'own_preference_required',403);}
  const member=person(tx.state,memberId);insist(member.role === 'member','member_required');
  if(staff)insist(input.bookingEmail === undefined && input.feedback === undefined && (tx.who.role === 'owner' || input.accessibility === undefined),'member_owned_choice_required',403);
  const requestId=text(input.requestId,'requestId',80),requestBasis=JSON.stringify(Object.keys(input).sort().map(k => [k,input[k]]));
  const prior=list(tx.state,'memberPreferenceEvent').find(e => e.actorId === tx.who.id && e.requestId === requestId);
  if(prior){insist(prior.requestBasis === requestBasis,'preference_request_changed',409);return visiblePreferences(prior.after,tx.who);}
  const before=structuredClone(preferencesOf(tx.state,member.id));
  insist(integer(input.revision ?? 0,'revision',0,Number.MAX_SAFE_INTEGER) === before.revision,'preferences_changed',409);
  const after: RecordData={...before,marketing:{...before.marketing},contactChannels:{...before.contactChannels},revision:before.revision+1,updatedAt:now(),updatedBy:tx.who.id,
    source:staff ? 'staff-'+staffChannel(input) : 'signed-in-member'};
  for(const channel of channels) {
    const field='marketing'+channel[0].toUpperCase()+channel.slice(1);
    if(input[field] !== undefined) {
      insist(typeof input[field] === 'boolean','invalid_'+field);
      if(input[field]) {
        text(input.consentStatement,'consentStatement',500);
        if(staff)text(input.sourceReference,'sourceReference',200);
        after.marketing[channel]=channel === 'sms' && before.marketing.sms !== 'confirmed' ? 'pending' : 'confirmed';
        // Fresh recorded permission clears a previous provider suppression only after native SMS reply confirmation.
        if(channel !== 'sms')tx.put('marketingSuppression',{id:`marketing-suppression:${member.id}:${channel}`,personId:member.id,channel,active:false,at:after.updatedAt,source:after.source});
      } else {after.marketing[channel]='denied';suppressMarketing(tx,member.id,channel,'preference_opt_out');}
    }
    const contact='contact'+channel[0].toUpperCase()+channel.slice(1);
    if(input[contact] !== undefined){insist(typeof input[contact] === 'boolean','invalid_'+contact);after.contactChannels[channel]=input[contact];}
  }
  for(const key of ['preferredTimes','preferredClasses','accessibility'] as const)if(input[key] !== undefined)after[key]=optional(input[key],key,key === 'accessibility'?2000:500);
  for(const key of ['attendanceSharing','feedback'] as const)if(input[key] !== undefined){insist(typeof input[key] === 'boolean','invalid_'+key);after[key]=input[key];}
  if(input.timeZone !== undefined){const zone=text(input.timeZone,'timeZone',100);try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format();}catch{insist(false,'invalid_timeZone');}after.timeZone=zone;}
  for(const key of ['quietStart','quietEnd'] as const)if(input[key] !== undefined)after[key]=clock(input[key],key);
  insist(after.quietStart !== after.quietEnd,'quiet_hours_need_distinct_bounds');
  if(input.attendanceSharing === true && before.attendanceSharing === false){text(input.consentStatement,'consentStatement',500);if(staff)text(input.sourceReference,'sourceReference',200);}
  if(input.bookingEmail !== undefined){insist(typeof input.bookingEmail === 'boolean','invalid_bookingEmail');saveMessagePreference(tx,{requestId:requestId+':booking',optedOut:!input.bookingEmail});}
  tx.put('memberPreference',after);
  const event={id:`${after.id}:event:${after.revision}`,personId:member.id,actorId:tx.who.id,actorRole:tx.who.role,staffMade:staff,channel:staff?staffChannel(input):'member-account',source:after.source,
    sourceReference:staff?input.sourceReference ?? null:null,consentStatement:input.consentStatement ?? null,at:after.updatedAt,requestId,requestBasis,before,after:structuredClone(after)};
  tx.put('memberPreferenceEvent',event);
  // Contact/channel permission is independent of booking, recognition and feedback choices.
  return visiblePreferences(after,tx.who);
}
export const saveOwnPreferences=(tx: Transaction,input: Record<string,unknown>) => save(tx,input,false);
export const saveStaffPreferences=(tx: Transaction,input: Record<string,unknown>) => save(tx,input,true);
export const visiblePreferences=(p: RecordData,who: Actor) => who.role === 'front-desk' ? {...p,accessibility:undefined,feedback:undefined} : p;
export function preferenceExport(state: State,who: Actor,personId: string) {
  if(who.role === 'member')insist(who.personId === personId,'own_preference_required',403);else requireMemberRecord(state,who,personId);
  person(state,personId,false);
  const history=list(state,'memberPreferenceEvent').filter(e => e.personId === personId).map(({requestBasis:_,...e}) => ({...e,before:visiblePreferences(e.before,who),after:visiblePreferences(e.after,who)}));
  return {personId,preference:visiblePreferences(preferencesOf(state,personId),who),bookingEmail:messagePreference(state,personId),history};
}

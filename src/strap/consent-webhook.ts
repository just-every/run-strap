import type { Bindings } from '../auth.server';
import { loadSystem, Transaction } from './domain/store';
import { DomainError, list, now } from './domain/types';
import { preferencesOf, suppressMarketing } from './domain/preferences';
import { assertTwilioRequest, verifiedTwilioForm } from './twilio/signature';

const response=(status:number,error?:string)=>error?Response.json({error},{status,headers:{'cache-control':'no-store'}}):new Response('<Response></Response>',{headers:{'content-type':'text/xml; charset=utf-8','cache-control':'no-store'}});
const digest=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
/** Twilio's documented URL + sorted form-field HMAC-SHA1 signature; no account sends or lookups. */
export async function smsConsentWebhook(request:Request,env:Bindings) {
  let form:URLSearchParams;
  try {
    assertTwilioRequest(request,env.AUTH_ORIGIN);
    if(!env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER)return response(503,'sms_consent_not_configured');
    form=await verifiedTwilioForm(request,env.AUTH_ORIGIN,env.TWILIO_AUTH_TOKEN);
  }catch(error){return error instanceof DomainError?response(error.status,error.code):response(500,'sms_callback_failed');}
  const from=form.get('From') ?? '',to=form.get('To'),messageId=form.get('MessageSid') ?? '',body=(form.get('Body') ?? '').trim().toUpperCase();
  if(to!==env.TWILIO_PHONE_NUMBER || !/^\+1\d{10}$/.test(from) || !messageId || messageId.length>100)return response(403,'invalid_sms_destination');
  const stop=['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(body),confirm=['YES','START'].includes(body);
  if(!stop && !confirm)return response(200);
  const loaded=await loadSystem(env.DB),tx=new Transaction(env.DB,loaded.state,loaded.who),eventId='sms-consent:'+await digest(messageId),basis=await digest(from+'\n'+to+'\n'+body),prior=tx.state.records.get(eventId)?.data;
  if(prior)return prior.basis===basis?response(200):response(409,'sms_event_changed');
  const members=list(tx.state,'memberCheckin').filter(r=>r.phone===from.slice(2)).map(r=>r.personId).filter(personId=>tx.state.people.some(p=>p.id===personId && !p.erasedAt));
  for(const personId of members) {
    const before=structuredClone(preferencesOf(tx.state,personId));
    if(!stop && (members.length!==1 || before.marketing.sms!=='pending'))continue;
    const after={...before,marketing:{...before.marketing,sms:stop?'denied':'confirmed'},revision:before.revision+1,updatedAt:now(),updatedBy:'twilio',source:'twilio-signed-webhook'};
    tx.put('memberPreference',after);
    tx.put('memberPreferenceEvent',{id:eventId+':'+personId,personId,before,after,actorId:'twilio',actorRole:'provider',staffMade:false,channel:'sms',source:'twilio-signed-webhook',sourceReference:messageId,at:after.updatedAt});
    tx.put('marketingSuppression',{id:`marketing-suppression:${personId}:sms`,personId,channel:'sms',active:stop,at:after.updatedAt,source:'twilio-signed-webhook',sourceReference:messageId});
    if(stop){suppressMarketing(tx,personId,'sms','provider_stop');tx.put('marketingSyncPending',{id:eventId+':sync:'+personId,personId,source:'twilio-signed-webhook',sourceReference:messageId,target:'connected-marketing-tools',status:'pending_external_sync',at:after.updatedAt});}
  }
  tx.put('smsConsentReceipt',{id:eventId,basis,at:now(),source:'twilio-signed-webhook'});await tx.commit();return response(200);
}

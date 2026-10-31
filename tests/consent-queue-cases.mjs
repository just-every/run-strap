import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
export async function consentQueueCases(h) {
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
  const member=await h.person('Elena'),day=86400000,expiresAt=new Date(Date.now()+20*day).toISOString()
  await h.cmd('profile.save',{phone:'5125550130',requestId:'synthetic-strap-phone'},member.cookie)
  const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:3,amountCents:6000,expiresAt})).id})
  const preference=async()=> (await h.send('/api/strap/preferences.json',undefined,member.cookie)).value.preference
  const choose=async(input,staff=false)=>h.cmd(staff?'preferences.save.staff':'preferences.save',{...(staff?{personId:member.id,channel:'phone',sourceReference:'Recorded member request'}:{}),revision:(await preference()).revision,requestId:'synthetic-strap-'+crypto.randomUUID(),...input},staff?h.owner:member.cookie)
  const sequence=async(channel)=>{const p=await h.cmd('renewal.sequence.prepare',{name:'Renewal '+channel,channel,text:'Please review your renewal options with the studio.',maxMessages:10});return h.cmd('renewal.sequence.approve',{id:p.id,key:p.key})}
  const enroll=async(rule,status=200)=>{const row=(await h.send('/api/strap/reports/renewals',undefined,h.owner)).value.rows.find(r=>r.packId===pack.id);return h.cmd('renewal.sequence.enroll',{sequenceId:rule.id,packId:pack.id,basis:row.basis},h.owner,status)}
  const sms=await sequence('sms');await enroll(sms,409)
  await choose({marketingSms:true,consentStatement:'Member stated SMS permission'},true)
  await enroll(sms,409)
  // Signed network-edge callbacks only; no SMS is sent or provider receipt claimed.
  const secret='synthetic-strap-1';await h.setAuth({TWILIO_AUTH_TOKEN:secret,TWILIO_PHONE_NUMBER:'+15125550131'})
  const callback=async(body,id,signature=true)=>{
    const url=h.origin+'/api/strap/consent/twilio',data={From:'+15125550130',To:'+15125550131',Body:body,MessageSid:id},form=new URLSearchParams(data)
    const signed=url+Object.keys(data).sort().map(k=>k+data[k]).join(''),value=createHmac('sha1',secret).update(signed).digest('base64')
    const r=await h.mf.dispatchFetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature?value:'synthetic-strap-invalid'},body:form.toString()});return r.status
  }
  const before=(await h.state()).version;assert.equal(await callback('YES','synthetic-strap-yes',false),403);assert.equal((await h.state()).version,before)
  assert.equal(await callback('YES','synthetic-strap-yes'),200);assert.equal((await preference()).marketing.sms,'confirmed')
  const queued=await enroll(sms);assert.equal(queued.status,'queued')
  const automationPreview=await h.cmd('automation.prepare',{name:'Held SMS review',trigger:'renewal',sequenceId:sms.id,channel:'sms',startAt:new Date(Date.now()-86400000).toISOString(),endAt:new Date(Date.now()+30*86400000).toISOString(),intervalMinutes:60,maxTasks:2,maxMessages:1});
  const automation=await h.cmd('automation.enable',{id:automationPreview.id,key:automationPreview.key});
  await h.cmd('automation.evaluate',{id:automation.id,requestId:'synthetic-strap-sms-private-evaluation'});
  const automationTask=(await h.state()).automation.tasks.find(t=>t.ruleId===automation.id&&t.sourceId===pack.id),providerVersion=(await h.state()).version;
  assert.equal((await h.cmd('automation.delivery.preview',{id:automationTask.id},h.owner,409)).error,'provider_delivery_unavailable');
  assert.equal((await h.state()).version,providerVersion,'native automation never manufactures provider delivery authority');
  console.log('PROBE AUTO-001 provider boundary: confirmed SMS source and enabled rule -> private task retained, message approval refused as provider delivery unavailable, zero writes');
  const shared=await h.person('SharedPhone')
  await h.cmd('profile.save',{phone:'5125550130',requestId:'synthetic-strap-shared-phone'},shared.cookie)
  const sharedPreference=async()=> (await h.send('/api/strap/preferences.json',undefined,shared.cookie)).value.preference
  const sharedChoose=async()=>h.cmd('preferences.save.staff',{personId:shared.id,channel:'phone',sourceReference:'Member phoned the studio',revision:(await sharedPreference()).revision,requestId:'synthetic-strap-'+crypto.randomUUID(),marketingSms:true,consentStatement:'Fresh SMS permission from the shared-phone member'},h.owner)
  await sharedChoose()
  assert.equal(await callback('STOP','synthetic-strap-stop'),200)
  assert.equal((await sharedPreference()).marketing.sms,'denied','STOP suppresses every member of a shared phone')
  const stopped=(await h.state()).marketingMessages.find(m=>m.id===queued.id);assert.equal(stopped.status,'suppressed');assert.equal(stopped.suppressionReason,'provider_stop')
  const version=(await h.state()).version;assert.equal(await callback('STOP','synthetic-strap-stop'),200);assert.equal((await h.state()).version,version)
  assert.equal(await callback('START','synthetic-strap-unsolicited-start'),200);assert.equal((await preference()).marketing.sms,'denied')
  const nextSms=await sequence('sms');await enroll(nextSms,409)
  await choose({marketingSms:true,consentStatement:'New SMS permission after STOP'},true);await enroll(nextSms,409)
  await sharedChoose()
  assert.equal(await callback('START','synthetic-strap-ambiguous-start'),200)
  assert.equal((await preference()).marketing.sms,'pending','a shared-phone reply confirms nobody')
  assert.equal((await sharedPreference()).marketing.sms,'pending')
  await h.cmd('profile.save',{phone:'5125550132',requestId:'synthetic-strap-distinct-phone'},shared.cookie)
  assert.equal(await callback('YES','synthetic-strap-reconfirm'),200);const smsMessage=await enroll(nextSms)
  assert.equal((await sharedPreference()).marketing.sms,'pending','the other member cannot inherit the unique reply')
  const exportRecord=(await h.send('/api/strap/preferences.json',undefined,member.cookie)).value
  assert.ok(exportRecord.history.some(e=>e.source==='twilio-signed-webhook'&&e.sourceReference==='synthetic-strap-stop'))
  assert.ok((await h.send('/api/strap/exit.json',undefined,h.owner)).text.includes('pending_external_sync'),'external synchronization is explicitly pending, never reported complete')
  // The native queue rechecks permission and pause, and holds marketing SMS (only) in quiet hours, without an external transport.
  // Real clocks, no faked application time: zones are picked by their current local hour, at least an hour from
  // a quiet-hour boundary, so this public-door case works at every UTC hour.
  const zones=['America/New_York','America/Los_Angeles','Pacific/Honolulu','Pacific/Guam','Europe/London','Asia/Singapore'],hour=timeZone=>Number(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',hour:'2-digit'}).format(new Date()))
  const nightZone=zones.find(z=>hour(z)>=21||hour(z)<9),dayZone=zones.find(z=>hour(z)>=11&&hour(z)<19);assert.ok(nightZone&&dayZone)
  const message=async id=>(await h.state()).marketingMessages.find(m=>m.id===id)
  // With no member zone recorded, the studio's clock applies the 20:00-10:00 floor to the text.
  await h.cmd('studio.save',{location:'Austin',timeZone:nightZone});await h.cmd('renewal.queue.review',{})
  assert.equal((await message(smsMessage.id)).holdReason,'quiet_hours')
  // A stricter member window keeps holding the text; in-app marketing waits only for its paused sequence.
  await choose({marketingInApp:true,consentStatement:'I request in-app renewal messages',timeZone:dayZone,quietStart:'00:00',quietEnd:'23:59'})
  const native=await sequence('inApp'),nativeMessage=await enroll(native);assert.deepEqual(await enroll(native),nativeMessage)
  await h.cmd('renewal.sequence.set',{id:native.id,enabled:false});await h.cmd('renewal.queue.review',{})
  assert.equal((await message(nativeMessage.id)).holdReason,'sequence_paused')
  await h.cmd('renewal.sequence.set',{id:native.id,enabled:true});await h.cmd('renewal.queue.review',{})
  assert.equal((await message(smsMessage.id)).holdReason,'quiet_hours');assert.equal((await message(nativeMessage.id)).status,'delivered')
  assert.equal((await message(nativeMessage.id)).holdReason,null,'a delivered outcome does not retain a misleading current pause reason')
  await h.cmd('renewal.queue.review',{});assert.equal((await h.state(member.cookie)).memberMessages.filter(m=>m.marketingMessageId===nativeMessage.id).length,1)
  // The member's recorded daytime zone, not the studio's night, governs: the text leaves quiet hours but has no native transport.
  await choose({quietStart:'20:00',quietEnd:'10:00'});await h.cmd('renewal.queue.review',{})
  assert.equal((await message(smsMessage.id)).holdReason,'provider_delivery_unavailable')
  const another=await sequence('inApp'),anotherMessage=await enroll(another)
  await choose({marketingInApp:false});assert.equal((await h.state()).marketingMessages.find(m=>m.id===anotherMessage.id).status,'suppressed')
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./preferences-browser.mjs')).renewalQueueBrowser(h,{member,pack})
}

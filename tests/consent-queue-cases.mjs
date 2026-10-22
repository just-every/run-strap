import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
export async function consentQueueCases(h) {
  await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'})
  const member=await h.person('ConsentQueue'),day=86400000,expiresAt=new Date(Date.now()+20*day).toISOString()
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
  assert.equal(await callback('STOP','synthetic-strap-stop'),200)
  const stopped=(await h.state()).marketingMessages.find(m=>m.id===queued.id);assert.equal(stopped.status,'suppressed');assert.equal(stopped.suppressionReason,'provider_stop')
  const version=(await h.state()).version;assert.equal(await callback('STOP','synthetic-strap-stop'),200);assert.equal((await h.state()).version,version)
  assert.equal(await callback('START','synthetic-strap-unsolicited-start'),200);assert.equal((await preference()).marketing.sms,'denied')
  const nextSms=await sequence('sms');await enroll(nextSms,409)
  await choose({marketingSms:true,consentStatement:'New SMS permission after STOP'},true);await enroll(nextSms,409)
  assert.equal(await callback('YES','synthetic-strap-reconfirm'),200);await enroll(nextSms)
  const exportRecord=(await h.send('/api/strap/preferences.json',undefined,member.cookie)).value
  assert.ok(exportRecord.history.some(e=>e.source==='twilio-signed-webhook'&&e.sourceReference==='synthetic-strap-stop'))
  assert.ok((await h.send('/api/strap/exit.json',undefined,h.owner)).text.includes('pending_external_sync'),'external synchronization is explicitly pending, never reported complete')
  // The native queue rechecks permission, pause and quiet hours without an external transport.
  const zones=['America/New_York','America/Los_Angeles','Pacific/Honolulu','Pacific/Guam'],zone=zones.find(timeZone=>{const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',hour:'2-digit'}).format(new Date()));return hour>=10&&hour<20});assert.ok(zone)
  await choose({marketingInApp:true,consentStatement:'I request in-app renewal messages',timeZone:zone,quietStart:'00:00',quietEnd:'23:59'})
  const native=await sequence('inApp'),nativeMessage=await enroll(native);assert.deepEqual(await enroll(native),nativeMessage)
  await h.cmd('renewal.queue.review',{});assert.equal((await h.state()).marketingMessages.find(m=>m.id===nativeMessage.id).holdReason,'quiet_hours')
  await choose({quietStart:'20:00',quietEnd:'10:00'})
  await h.cmd('renewal.sequence.set',{id:native.id,enabled:false});await h.cmd('renewal.queue.review',{})
  assert.equal((await h.state()).marketingMessages.find(m=>m.id===nativeMessage.id).holdReason,'sequence_paused')
  await h.cmd('renewal.sequence.set',{id:native.id,enabled:true});await h.cmd('renewal.queue.review',{})
  assert.equal((await h.state()).marketingMessages.find(m=>m.id===nativeMessage.id).status,'delivered')
  await h.cmd('renewal.queue.review',{});assert.equal((await h.state(member.cookie)).memberMessages.filter(m=>m.marketingMessageId===nativeMessage.id).length,1)
  const another=await sequence('inApp'),anotherMessage=await enroll(another)
  await choose({marketingInApp:false});assert.equal((await h.state()).marketingMessages.find(m=>m.id===anotherMessage.id).status,'suppressed')
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./preferences-browser.mjs')).renewalQueueBrowser(h,{member,pack})
}

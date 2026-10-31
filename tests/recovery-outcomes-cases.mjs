import assert from 'node:assert/strict'

/** Continues the elapsed recovery journey through real offers, booking and
 * corrected attendance, without adding point-sized test registrations. */
export async function recoveryOutcomeCases(h,{coach,jump:baseJump}) {
  const day=86400000,persons=[]
  const jump=async at=>{await baseJump(at);for(const p of persons)p.cookie=await h.signIn(p.email)}
  for(const name of ['OutcomeAccepted','OutcomeNoShow','OutcomeExpired','OutcomeSuppressed','OutcomeOptout','OutcomeFrozen','OutcomeUnaccepted']){
    const p=await h.cmd('person.save',{name,email:name.toLowerCase()+String.fromCharCode(64)+'studio.example',role:'member',active:true})
    await h.cmd('person.invite',{id:p.id});p.cookie=await h.signIn(p.email);persons.push(p)
  }
  const [accepted,noShow,expired,suppressed,optout,frozen,unaccepted]=persons
  const packs=new Map()
  for(const p of persons) {
    packs.set(p.id,await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:10,amountCents:10000,eligibleServices:['Outcome Yoga'],expiresAt:'2099-12-31T00:00:00Z'})).id}))
    if(p!==optout)await h.cmd('preferences.save',{revision:0,requestId:'synthetic-strap-outcome-consent',marketingInApp:true,consentStatement:'Send class invitations to my studio account'},p.cookie)
  }
  const start=new Date(Date.now()+2*day).toISOString()
  const publish=async(title,at,room)=>{
    const d=new Date(at),week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
    return (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title,service:'Outcome Yoga',room,start:at,end:new Date(Date.parse(at)+3600000).toISOString(),capacity:20,instructorId:coach.id}]})).id})).classes[0]
  }
  const entry=await publish('Observed recovery class',start,'Outcome first'),later=await publish('Later recovery class',new Date(Date.parse(start)+day).toISOString(),'Outcome later'),future=await publish('Future recovery class',new Date(Date.parse(start)+20*day).toISOString(),'Outcome future')
  const type=await h.cmd('freeze.type.save',{name:'Outcome leave',reason:'Member request',feeCents:0,defaultLengthDays:10,maxLengthDays:30})
  const freeze=await h.cmd('freeze.prepare',{personId:frozen.id,packId:packs.get(frozen.id).id,freezeTypeId:type.id,startAt:start.slice(0,10),endAt:new Date(Date.parse(start)+10*day).toISOString().slice(0,10),requestId:'synthetic-strap-outcome-freeze',channel:'phone'})
  if(freeze.requiresAcceptance)await h.cmd('freeze.accept',{id:freeze.id,key:freeze.key},frozen.cookie)
  await h.cmd('freeze.confirm',{id:freeze.id,key:freeze.key,requestId:'synthetic-strap-outcome-freeze-confirm',channel:'phone'})
  const input={classId:entry.id,personIds:persons.map(p=>p.id),leadMinutes:10080,maxPer30Days:30,incentiveCents:0,budgetCents:0,text:'Review this available class in your studio account'}
  const campaign=await h.cmd('lead.empty.prepare',input)
  assert.equal(campaign.audience.find(r=>r.personId===optout.id).reason,'permission_denied')
  assert.ok(campaign.audience.find(r=>r.personId===frozen.id).reason,'frozen class is not an eligible invitation')
  await h.cmd('lead.empty.approve',{id:campaign.id,key:campaign.key})
  const offers=(await h.state()).emptyPlaces.offers.filter(o=>o.campaignId===campaign.id),offerFor=p=>offers.find(o=>o.personId===p.id)
  assert.equal(offers.length,5)
  const booked=await h.cmd('lead.empty.accept',{id:offerFor(accepted).id,requestId:'synthetic-strap-outcome-accept'},accepted.cookie)
  const missed=await h.cmd('lead.empty.accept',{id:offerFor(noShow).id,requestId:'synthetic-strap-outcome-missed'},noShow.cookie)
  await h.cmd('preferences.save',{revision:1,requestId:'synthetic-strap-outcome-withdraw',marketingInApp:false},suppressed.cookie)
  await h.cmd('attendance.availability.save',{version:0,windows:[{start:later.start,end:later.end}],locationIds:['studio']},accepted.cookie)
  const plan=await h.cmd('attendance.plan.prepare',{personId:accepted.id})
  const laterBooking=await h.cmd('attendance.plan.accept',{id:plan.id,classId:later.id},accepted.cookie)
  const futureBooking=await h.cmd('booking.book',{classId:future.id},accepted.cookie)
  await h.cmd('attendance.checkin',{id:futureBooking.id},coach.cookie)
  const query='/api/strap/reports/recovery-outcomes?campaign='+campaign.id
  const report=async suffix=>{const response=await h.send(query+(suffix ?? ''),undefined,h.owner);assert.equal(response.status,200,response.text);return response.value}
  let r=await report()
  assert.deepEqual([r.totals.accepted,r.totals.unaccepted,r.totals.suppressed,r.totals.expired,r.totals.attendedVisits],[2,2,1,0,0])
  assert.equal(r.rows.find(row=>row.personId===optout.id).status,'excluded')
  assert.equal(r.rows.find(row=>row.personId===frozen.id).status,'excluded')
  const winInput={personIds:[expired.id],cadenceDays:1,rewardCents:0,budgetCents:0,offerDays:1,text:'Review a finite return membership',planName:'Observed return',days:30,amountCents:5000,eligibleServices:['Outcome Yoga']}
  // Only genuine former membership sources qualify; no synthetic conversion
  // or balance is manufactured to fill this report.
  const preview=await h.cmd('lead.winback.prepare',winInput)
  assert.equal(preview.audience[0].reason,'active_membership')
  const incentive=await h.cmd('lead.empty.prepare',{...input,personIds:[unaccepted.id],incentiveCents:100,budgetCents:100})
  await h.cmd('lead.empty.approve',{id:incentive.id,key:incentive.key})
  assert.equal((await h.send('/api/strap/reports/recovery-outcomes',undefined,h.owner)).value.outsideCoverage,1)
  assert.equal((await h.send('/api/strap/reports/recovery-outcomes?campaign='+preview.id,undefined,h.owner)).status,404,'unapproved previews are not cohorts')
  await jump(new Date(Date.parse(later.end)+60000).toISOString())
  await h.cmd('attendance.checkin',{id:booked.id},coach.cookie)
  await h.cmd('attendance.noshow',{id:missed.id},coach.cookie)
  await h.cmd('attendance.checkin',{id:laterBooking.id},coach.cookie)
  r=await report()
  assert.equal(r.totals.attendedVisits,2);assert.equal(r.totals.measuredMembers,2);assert.equal(r.totals.membersWithVisits,1)
  assert.equal(r.totals.expired,2,'elapsed unaccepted offers are expired, never declines')
  assert.equal(r.totals.suppressed,1,'a withdrawn invitation stays suppressed after expiry')
  await h.cmd('preferences.save',{revision:2,requestId:'synthetic-strap-outcome-new-permission',marketingInApp:true,consentStatement:'Send new future invitations only'},suppressed.cookie)
  assert.equal((await report()).rows.find(row=>row.personId===suppressed.id).status,'suppressed','renewed permission never revives the old intervention')
  assert.ok(r.rows.find(row=>row.personId===noShow.id).observations.some(v=>v.bookingId===missed.id&&!v.counted&&v.attendance==='no_show'))
  assert.equal(r.rows.find(row=>row.personId===accepted.id).observations.find(v=>v.bookingId===laterBooking.id).attendancePlanId,plan.id)
  assert.ok(!r.rows.some(row=>row.attendedBookingIds.includes(futureBooking.id)),'future check-in is not completed attendance')
  await h.cmd('attendance.correct',{id:missed.id,outcome:'attended',reason:'Paper roster confirmed completed attendance'})
  r=await report();assert.equal(r.totals.attendedVisits,3);assert.equal(r.totals.membersWithVisits,2)
  const corrected=r.rows.find(row=>row.personId===noShow.id)
  assert.equal(corrected.observations[0].corrections[0].from,'no_show')
  assert.equal(corrected.observations[0].corrections[0].to,'attended')
  assert.equal((await report('&windowDays=1')).totals.attendedVisits,0,'outside observation window is not attributed')
  assert.ok(r.totals.incompleteWindows>0);assert.equal(r.totals.causalConclusion,'inconclusive')
  assert.equal(r.totals.collectedRenewalCents,null);assert.equal(r.unavailable.failedRenewals,null);assert.equal(r.unavailable.declinedInterventions,null)
  const before=(await h.db.prepare('SELECT id,kind,data FROM st_records ORDER BY id').all()).results,version=(await h.state()).version
  for(const p of [accepted,noShow,coach]) {
    assert.equal((await h.send(query,undefined,p.cookie)).status,403)
    assert.equal((await h.send('/app/recovery-outcomes',undefined,p.cookie)).status,403)
  }
  assert.deepEqual((await h.db.prepare('SELECT id,kind,data FROM st_records ORDER BY id').all()).results,before,'denied reads change no source records')
  assert.equal((await h.state()).version,version)
  const key=await h.cmd('agent.create',{label:'Synthetic outcome preparation'})
  assert.equal((await h.send(query,undefined,'',{authorization:'Bearer '+key.token})).status,401)
  await h.cmd('agent.revoke',{id:key.id})
  assert.equal((await h.send(query,undefined,'',{authorization:'Bearer '+key.token})).status,401)
  const readBefore=(await h.db.prepare('SELECT id,kind,data FROM st_records ORDER BY id').all()).results,readVersion=(await h.state()).version
  const detail=await report('&offer='+offerFor(noShow).id)
  assert.equal(detail.selected.source.offer.bookingId,missed.id)
  assert.equal((await h.send(detail.selected.observations[0].url,undefined,h.owner)).status,200)
  const {recoveryOutcomesBrowser}=await import('./campaign-browser.mjs')
  await recoveryOutcomesBrowser(h,{campaignId:campaign.id,offerId:offerFor(noShow).id,bookingId:missed.id,visits:3})
  assert.deepEqual((await h.db.prepare('SELECT id,kind,data FROM st_records ORDER BY id').all()).results,readBefore,'every report and drill-through read leaves source records unchanged')
  assert.equal((await h.state()).version,readVersion)
  assert.equal((await h.send(query,{},h.owner)).status,404,'no report write door exists')
  await jump(new Date(Date.parse(start)+35*day).toISOString())
  r=await report();assert.equal(r.totals.incompleteWindows,0);assert.equal(r.totals.completeWindows,5);assert.equal(r.totals.causalConclusion,'inconclusive')
  const former=[]
  for(const name of ['OutcomeFormerAccepted','OutcomeFormerSuppressed']) {
    const p=await h.cmd('person.save',{name,email:name.toLowerCase()+String.fromCharCode(64)+'studio.example',role:'member',active:true})
    await h.cmd('person.invite',{id:p.id});p.cookie=await h.signIn(p.email);persons.push(p);former.push(p)
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:2,amountCents:3000,eligibleServices:['Outcome Yoga'],expiresAt:new Date(Date.now()+day).toISOString()})).id})
    await h.cmd('preferences.save',{revision:0,requestId:'synthetic-strap-former-consent',marketingInApp:true,consentStatement:'Offer finite return terms in my account'},p.cookie)
  }
  await jump(new Date(Date.now()+2*day).toISOString())
  const win=await h.cmd('lead.winback.prepare',{...winInput,personIds:former.map(p=>p.id),offerDays:7})
  assert.ok(win.audience.every(row=>!row.reason))
  await h.cmd('lead.winback.approve',{id:win.id,key:win.key})
  const returnOffers=(await h.state()).winback.offers.filter(o=>o.campaignId===win.id),returnOffer=returnOffers.find(o=>o.personId===former[0].id)
  const purchased=await h.cmd('lead.winback.purchase',{id:returnOffer.id,key:returnOffer.key,confirm:true,requestId:'synthetic-strap-outcome-return'},former[0].cookie)
  await h.cmd('preferences.save',{revision:1,requestId:'synthetic-strap-outcome-return-withdraw',marketingInApp:false},former[1].cookie)
  const returnClass=await publish('Observed return visit',new Date(Date.now()+day).toISOString(),'Outcome return')
  const returnBooking=await h.cmd('booking.book',{classId:returnClass.id},former[0].cookie)
  await h.cmd('attendance.checkin',{id:returnBooking.id},coach.cookie)
  let returned=(await h.send('/api/strap/reports/recovery-outcomes?campaign='+win.id,undefined,h.owner)).value
  assert.deepEqual([returned.totals.accepted,returned.totals.suppressed,returned.totals.attendedVisits],[1,1,0])
  await jump(new Date(Date.parse(returnClass.end)+60000).toISOString())
  returned=(await h.send('/api/strap/reports/recovery-outcomes?campaign='+win.id+'&offer='+returnOffer.id,undefined,h.owner)).value
  assert.equal(returned.totals.attendedVisits,1);assert.equal(returned.selected.source.offer.packId,purchased.id)
  assert.equal(returned.totals.collectedRenewalCents,null,'a native balance charge is not collected renewal revenue')
  console.log('PROBE SUCCESS-004 renewal boundary: approved zero-incentive win-back purchase and later completed class -> source-linked visit; studio balance is not collection and renewal revenue remains unavailable')
  console.log('PROBE SUCCESS-004 approved campaign: native owner approval and two accepted offers -> seven audience members, corrected completed visits with source links; no inferred declines or collected revenue')
  console.log('PROBE SUCCESS-004 observations: elapsed no-show then correction -> 2 then 3 distinct completed visits; future visit excluded; one-day window -> 0')
  console.log('PROBE SUCCESS-004 exclusions: member opt-out and freeze -> excluded audience; current withdrawal -> suppressed offer; elapsed no response -> expired')
  console.log('PROBE SUCCESS-004 completeness: 30-day observation before and after window end -> incomplete then complete; causal conclusion remains inconclusive')
  console.log('PROBE SUCCESS-004 authority and reads: member, instructor and revoked agent reads denied; owner screen, JSON and source reads leave records and revision unchanged')
}

export async function recoveryOutcomeJourney(h) {
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save',{location:'Observed outcomes studio',timeZone:'America/New_York'})
  const coach=await h.person('OutcomeCoach','instructor')
  const {readFile,writeFile,rename}=await import('node:fs/promises'),{totp}=await import('./mfa-helpers.mjs')
  const originalCmd=h.cmd,originalState=h.state
  let owner=h.owner,offset=Number(await readFile(process.env.STRAP_RECOVERY_CLOCK,'utf8'))
  h.cmd=(name,input,cookie=owner,...rest)=>originalCmd(name,input,cookie,...rest)
  h.state=(cookie=owner,...rest)=>originalState(cookie,...rest)
  const jump=async at=>{
    const realNow=Date.now()-offset*1000
    offset=Math.ceil((Date.parse(at)-realNow)/1000)
    await writeFile(process.env.STRAP_RECOVERY_CLOCK+'.new','+'+offset+'\n')
    await rename(process.env.STRAP_RECOVERY_CLOCK+'.new',process.env.STRAP_RECOVERY_CLOCK)
    await new Promise(resolve=>setTimeout(resolve,50))
    owner=await h.signIn(h.auth.OWNER_EMAIL);h.owner=owner
    await h.cmd('mfa.verify',{code:totp(h.mfaOwner.secret)})
    coach.cookie=await h.signIn(coach.email)
  }
  await recoveryOutcomeCases(h,{coach,jump})
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { harness } from './harness.mjs'
import { reconstructExit } from './exit-receiver.mjs'
const exec = promisify(execFile)
const cli = resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const command = async (cwd, args, expected = 0) => {
  let result
  // These commands own a separate checkout, not the parent verify operation.
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
  delete env.RER_LOCAL_OPERATION
  delete env.RER_LOCAL_STATE_PATH
  try { result = { ...await exec(process.execPath, [cli, ...args], { cwd, env, maxBuffer: 2e6 }), code: 0 } }
  catch (error) { result = error }
  assert.equal(result.code, expected, `${args[0]}: ${result.stdout ?? ''} ${result.stderr ?? ''}`)
}
async function checkout(root) {
  await mkdir(root)
  for (const name of ['package.json','pnpm-lock.yaml','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','SEED-COMMAND-CONTRACT.md','OPERATIONS.md','.node-version','wrangler.jsonc','deploy.json','rer-setup.json','scripts','src','migrations']) await cp(name, join(root,name), { recursive: true })
  await symlink(resolve('node_modules'), join(root,'node_modules'), 'dir')
}
const integrationKey = async h => (await (await h.mf.dispatchFetch(h.origin + '/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations', { method: 'POST', redirect: 'manual', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ label: 'Excluded integration', 'sc_roster:read': 'true', 'sc_attendance:read': 'true', location: 'studio', 'ev_booking.changed': 'true', 'ev_attendance.changed': 'true' }).toString() })).text()).match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)[1]
const integrationRead = (h, token, resource = 'roster') => h.mf.dispatchFetch(h.origin + '/api/strap/integration/' + resource, { headers: { host: new URL(h.origin).host, authorization: `Bearer ${token}`, 'strap-schema-version': '1' } })
test('MOVE-011 / ARCHIVE-001 / SCHED-001 / SCHED-014 / SCHED-005 / APP-003 / API-002: portable exit reconstruction and public CLI archive round trip refuses damaged or populated stores and respects erasure, including a member’s emergency contact and its history', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(),'strap-archive-')), source=join(temporary,'source'), restored=join(temporary,'restored'), erased=join(temporary,'erased')
  let h
  try {
    for (const path of [source,restored,erased]) await checkout(path)
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'], { cwd:source, env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}, maxBuffer:2e6 })
    h=await harness({root:source})
    assert.equal((await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303)
    const p=await h.cmd('person.save',{name:'Temporary joiner',email:'temporary@venue.example',role:'member',active:false})
    // APP-003: a staff-entered emergency contact is the third party's personal data and follows the member.
    const contact=await h.cmd('profile.save.staff',{personId:p.id,phone:'(212) 555-0144',emergencyName:'Rita Joiner',emergencyPhone:'212-555-0188',emergencyRelationship:'Mother',channel:'phone',revision:0,requestId:'archive-profile'})
    assert.deepEqual(contact.emergencyContact,{name:'Rita Joiner',phone:'2125550188',relationship:'Mother'})
    const member = await h.person('Maya'), coach = await h.person('Priya','instructor')
    const draft = await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:'2099-12-01T00:00:00Z'})
    await h.cmd('pack.approve',{id:draft.id})
    await h.cmd('studio.save',{location:'New York studio',timeZone:'America/New_York'})
    const week='2099-11-02', timetable=await h.cmd('classes.prepare',{week,classes:[{title:'Restored Pilates',start:week+'T10:00:00Z',end:week+'T11:00:00Z',capacity:12,instructorId:coach.id}]})
    await h.cmd('classes.publish',{id:timetable.id})
    await h.cmd('waiver.publish',{text:'Earlier studio waiver.'})
    const waiver=await h.cmd('waiver.publish',{text:'Studio waiver, "current"\nKeep your own limits.'})
    await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie)
    await h.cmd('booking.book',{classId:(await h.state()).classes[0].id},member.cookie)
    const repeating=await h.cmd('series.publish',{id:(await h.cmd('series.prepare',{startDate:'2099-11-03',endDate:'2099-11-10',time:'09:00',minutes:50,title:'Restored weekly mobility',service:'Mobility',room:'Movement',capacity:2,instructorId:coach.id})).id})
    const closedOccurrence=await h.cmd('series.cancel.prepare',{classId:repeating.classes[1].id,scope:'this',reason:'Holiday closure'})
    await h.cmd('series.cancel.confirm',{id:closedOccurrence.id,impact:closedOccurrence.impact.key})
    const reservationPreview=await h.cmd('reservation.prepare',{classId:repeating.classes[0].id,throughDate:repeating.series.endDate},member.cookie)
    const reservation=await h.cmd('reservation.confirm',{id:reservationPreview.id,key:reservationPreview.key},member.cookie)
    const seriesBooking=(await h.state(member.cookie)).bookings.find(b=>b.id===reservation.outcomes[0].bookingId)
    await h.cmd('payment.record',{personId:member.id,amountCents:5000,reference:'Processor-backup-1'})
    const csv=await readFile('tests/fixtures/members.csv','utf8'),preview=await h.cmd('import.preview',{csv})
    await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})
    const key=await h.cmd('agent.create',{label:'Excluded secret'})
    const integration={token:await integrationKey(h)}
    assert.equal((await integrationRead(h,integration.token)).status,200)
    assert.equal((await integrationRead(h,integration.token,'attendance')).status,200,'API-002 explicitly granted attendance scope reads before archive')
    await h.cmd('mail.connect',{})
    assert.equal((await h.send('/api/strap/exit.json')).status,401)
    for(const cookie of [member.cookie,coach.cookie]) assert.equal((await h.send('/api/strap/exit.json',undefined,cookie)).status,403)
    assert.equal((await h.send('/api/strap/exit.json',undefined,'',{authorization:`Bearer ${key.token}`})).status,401)
    const download=await h.send('/api/strap/exit.json',undefined,h.owner)
    assert.equal(download.status,200)
    assert.equal(download.headers.get('content-disposition'),'attachment; filename="strap-exit.json"')
    assert.equal(download.headers.get('cache-control'),'no-store')
    const portable=download.value
    reconstructExit(portable,csv)
    for(const value of [key.token,integration.token,'Excluded integration',h.auth.SESSION_SECRET,h.auth.SETUP_TOKEN,h.owner]) assert.ok(!download.text.includes(value))
    assert.ok(Object.keys(portable.tables).every(name=>!name.startsWith('oa_')&&!name.includes('outbox')&&!name.includes('agent_keys')&&!name.includes('integration')),'API-002 integration keys stay out of the portable exit')
    if(process.env.STRAP_PROOF_DIR) await (await import('./exit-browser.mjs')).exitBrowser(h,portable)
    const identity={auth:h.auth,owner:h.owner}
    await h.close();h=null
    const old=join(temporary,'before.rer'),later=join(temporary,'later.rer'),again=join(temporary,'again.rer')
    await command(source,['export','--output',old,'--no-queue'])
    const bytes=await readFile(old,'utf8');assert.ok(bytes.includes('Temporary joiner'));assert.ok(bytes.includes('Rita Joiner'),'APP-003 the emergency contact and its history travel in the native archive');assert.ok(!bytes.includes('Excluded secret'));assert.ok(!bytes.includes('token_hash'));assert.ok(!bytes.includes('Excluded integration'),'API-002 integration keys never travel in the native archive')
    await command(restored,['import','--input',old,'--yes','--no-queue'])
    await command(restored,['export','--output',again,'--no-queue'])
    const rows=text=>text.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='part')
    assert.ok(rows(bytes).length>0);assert.deepEqual(rows(await readFile(again,'utf8')),rows(bytes))
    // Recover access through native sign-in; the old session never travels.
    h=await harness({root:restored,...identity})
    assert.equal((await h.send('/api/strap/exit.json',undefined,identity.owner)).status,401)
    const restoredOwner=await h.signIn(h.auth.OWNER_EMAIL)
    assert.equal((await integrationRead(h,integration.token)).status,401,'API-002 a restored studio refuses the old integration secret')
    assert.equal((await integrationRead(h,integration.token,'attendance')).status,401,'API-002 restored attendance scope is refused too')
    assert.deepEqual((await h.state(restoredOwner)).integrations,[],'API-002 integration keys never restore')
    const restoredDownload=await h.send('/api/strap/exit.json',undefined,restoredOwner)
    assert.equal(restoredDownload.status,200)
    assert.deepEqual(restoredDownload.value.tables,portable.tables)
    const restoredReservations=await h.state(restoredOwner)
    assert.deepEqual(restoredReservations.reservations.find(r=>r.id===reservation.id),reservation,'SCHED-005 native restore retains occurrence outcomes and booking identities')
    assert.equal(restoredReservations.reservationPreviews.find(r=>r.id===reservationPreview.id).status,'confirmed')
    assert.equal(restoredReservations.reservations.find(r=>r.id===reservation.id).outcomes[1].reason,'class_cancelled','SCHED-005 the member keeps the skipped date and reason after restore')
    assert.deepEqual((await h.state(restoredOwner)).people.find(row=>row.id===p.id).emergencyContact,contact.emergencyContact,'APP-003 the restored member keeps their emergency contact')
    assert.equal((await h.state(restoredOwner)).profileChanges.filter(c=>c.personId===p.id).length,1,'APP-003 the restored member keeps one profile change')
    assert.equal((await h.state(restoredOwner)).waiver.id,waiver.id)
    reconstructExit(restoredDownload.value,csv)
    const mail=(await h.db.prepare('SELECT message FROM rer_mail_development_outbox').all()).results.map(r=>JSON.parse(r.message))
    assert.ok(mail.length>0)
    assert.ok(mail.every(m=>m.text.includes('/auth/confirm?token=')), 'restoration/download produced no studio message or collection; only fresh access mail')
    // MSG-004 under MOVE-011: member email stays paused on the restored installation until its owner reconnects it.
    assert.equal((await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:restoredOwner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303)
    const studioPage=await h.send('/app/studio',undefined,restoredOwner)
    assert.match(studioPage.text,/Member email paused[\s\S]*Reconnect member email/,`${studioPage.status} ${studioPage.headers.get('location')}`)
    const seriesEdit=await h.cmd('series.change.prepare',{classId:repeating.classes[0].id,scope:'this',reason:'Recovery studio review',change:{time:'10:00'}},restoredOwner)
    await h.cmd('series.change.approve',{id:seriesEdit.id,impact:seriesEdit.impact.key},restoredOwner)
    const recoveredSeries=await h.state(restoredOwner)
    assert.equal(recoveredSeries.series.find(row=>row.id===repeating.series.id).classIds[0],repeating.classes[0].id)
    assert.equal(recoveredSeries.bookings.find(row=>row.id===seriesBooking.id).seriesChangeId,seriesEdit.id)
    assert.equal(recoveredSeries.noticeDeliveries.find(row=>recoveredSeries.bookingActions.some(a=>a.id===row.sourceId&&a.seriesChangeId===seriesEdit.id)).status,'paused','SCHED-001 changes remain paused after native restore')
    const lee=await h.cmd('person.save',{name:'Lee',email:'lee@studio.example',role:'member',active:true},restoredOwner)
    await h.cmd('person.invite',{id:lee.id},restoredOwner);lee.cookie=await h.signIn('lee@studio.example')
    const seat=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:'Restored Reformer',start:week+'T13:00:00Z',end:week+'T14:00:00Z',capacity:1,instructorId:coach.id}]},restoredOwner)).id},restoredOwner)).classes[0]
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:lee.id,credits:2,amountCents:4000,expiresAt:'2099-12-01T00:00:00Z'},restoredOwner)).id},restoredOwner)
    await h.cmd('waiver.acknowledge',{id:waiver.id},lee.cookie)
    const first=await h.cmd('booking.book',{classId:seat.id},await h.signIn('maya@studio.example'))
    assert.equal((await h.cmd('booking.book',{classId:seat.id},lee.cookie)).status,'waitlisted')
    await h.cmd('booking.cancel',{id:first.id,cancelReason:'Other'},restoredOwner)
    let restoredState=await h.state(restoredOwner)
    assert.equal(restoredState.bookings.find(b=>b.classId===seat.id&&b.personId===lee.id).status,'booked')
    assert.equal(restoredState.noticeDeliveries.find(d=>d.sourceKind==='confirmation'&&d.sourceId===first.id).status,'paused','new booking confirmations stay paused after restore')
    assert.equal(restoredState.noticeDeliveries.find(d=>d.sourceKind==='confirmation'&&d.personId===lee.id).status,'paused','waitlist confirmations also stay paused after restore')
    assert.deepEqual(restoredState.noticeDeliveries.filter(d=>d.sourceKind!=='confirmation').map(d=>[d.sourceKind,d.personId,d.status]),[['booking_action',member.id,'paused'],['booking_action',member.id,'paused'],['booking',lee.id,'paused']], 'series changes, cancellation and promotion email stay paused after restore')
    assert.match((await h.state(lee.cookie)).notices.map(n=>n.subject).join(),/You're booked: Restored Reformer/)
    await h.cmd('mail.connect',{},restoredOwner)
    assert.doesNotMatch((await h.send('/app/studio',undefined,restoredOwner)).text,/Member email paused/)
    const closing=await h.cmd('closure.prepare',{scope:'class',classId:seat.id,reason:'Restored test'},restoredOwner)
    await h.cmd('closure.confirm',{id:closing.id,impact:closing.impact.key},restoredOwner)
    restoredState=await h.state(restoredOwner)
    assert.deepEqual(restoredState.noticeDeliveries.filter(d=>d.sourceKind!=='confirmation').map(d=>d.status),['paused','paused','paused','not_configured'])
    await h.close();h=null
    await command(restored,['import','--input',old,'--yes','--no-queue'],4)
    const corrupt=join(temporary,'corrupt.rer');await writeFile(corrupt,bytes.replace('Temporary joiner','Changed joiner'),{mode:0o600})
    // Checksum damage is a transfer failure (1); restore policy conflicts remain 4.
    await command(erased,['import','--input',corrupt,'--yes','--no-queue'],1)
    h=await harness({root:source,...identity});await h.cmd('person.erase',{id:p.id,revision:1},await h.signIn(h.auth.OWNER_EMAIL));await h.close();h=null
    await command(source,['export','--output',later,'--no-queue'])
    const erasedBytes=await readFile(later,'utf8')
    for(const value of ['Rita Joiner','2125550188','2125550144','temporary@venue.example']) assert.ok(!erasedBytes.includes(value),`APP-003 erasure removes ${value} from the later archive`)
    // APP-003: the pre-erasure archive still holds the contact, so the later journal fences it.
    await command(erased,['import','--input',old,'--journal',later,'--yes','--no-queue'],4)
    await command(erased,['import','--input',later,'--yes','--no-queue'])
    const proxy=await getPlatformProxy({configPath:join(erased,'wrangler.jsonc'),persist:{path:join(erased,'.wrangler/state/v3')},remoteBindings:false})
    try {
      assert.equal((await proxy.env.DB.prepare('SELECT name FROM st_people WHERE id=?').bind(p.id).first()).name,'Erased person')
      const kept=(await proxy.env.DB.prepare("SELECT kind,data FROM st_records WHERE kind IN ('memberProfile','profileChange','memberCheckin') AND json_extract(data,'$.personId')=?").bind(p.id).all()).results
      assert.deepEqual(kept.map(r=>r.kind),['profileChange'],'APP-003 erasure deletes the current contact and the check-in phone')
      const entry=JSON.parse(kept[0].data)
      assert.deepEqual([entry.erased,entry.changed,entry.channel,entry.staffMade,'before' in entry,'after' in entry,'requestBasis' in entry],[true,['phone','emergencyContact'],'phone',true,false,false,false],'APP-003 the change keeps who acted and when; its values are erased')
    }
    finally { await proxy.dispose() }
  } finally { if(h)await h.close();await rm(temporary,{recursive:true,force:true}) }
})

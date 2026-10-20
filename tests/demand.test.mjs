import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from './harness.mjs'

// SUCCESS-006: the connected agent proposes; the native owner evaluates and
// approves a frozen timetable, including the existing reservations and notices.
test('SUCCESS-006 cited demand, additional/retimed/covered classes and fresh human previews', {timeout:180000}, async () => {
  const mails=[]
  await run(async h => {
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    await h.cmd('studio.save',{name:'Juniper Movement',location:'Brooklyn',timeZone:'America/New_York'})
    const original=await h.person('Morgan','instructor'),cover=await h.person('Riley','instructor')
    const ana=await h.person('Ana'),ben=await h.person('Ben'),cara=await h.person('Cara')
    const waiver=await h.cmd('waiver.publish',{text:'Practice within your limits.'})
    for(const p of [ana,ben,cara]) {
      await h.cmd('waiver.acknowledge',{id:waiver.id},p.cookie)
      const pack=await h.cmd('pack.prepare',{personId:p.id,credits:10,amountCents:18000,expiresAt:new Date(Date.now()+90*86400000).toISOString()})
      await h.cmd('pack.approve',{id:pack.id})
    }
    const start=new Date(Date.now()+14*86400000);start.setUTCHours(15,0,0,0)
    const at=hours=>new Date(+start+hours*3600000).toISOString()
    const monday=new Date(start);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7))
    const fields=(title,hour,capacity=1)=>({title,service:'Mat',room:'Garden room',start:at(hour),end:at(hour+1),capacity,instructorId:original.id})
    const raw=await h.cmd('classes.prepare',{week:monday.toISOString().slice(0,10),classes:[fields('Morning Mat',0),fields('Quiet Mat',3,8)]})
    const published=await h.cmd('classes.publish',{id:raw.id}),full=published.classes[0],quiet=published.classes[1]
    const booked=await h.cmd('booking.book',{classId:full.id},ana.cookie)
    await h.cmd('booking.book',{classId:full.id},ben.cookie)
    await h.cmd('booking.book',{classId:full.id},cara.cookie)
    await h.cmd('attendance.checkin',{id:booked.id},original.cookie)
    await h.cmd('substitution.qualification.save',{instructorId:cover.id,service:'Mat',qualified:true,requestId:'riley-mat'})
    const sub=await h.cmd('substitution.request',{classId:quiet.id,reason:'Training day',requestId:'quiet-cover'})
    const subDraft=await h.cmd('substitution.prepare',{requestId:sub.id,instructorId:cover.id})
    await h.cmd('substitution.approve',{id:subDraft.id,impact:subDraft.impact.key})
    const unavailable=await h.cmd('scheduling.unavailable.save',{resourceKind:'instructor',resourceId:cover.id,start:at(20),end:at(21),reason:'PRIVATE APPOINTMENT'})
    const key=await h.cmd('agent.create',{label:'Demand planning assistant'})
    const agentHeaders={authorization:'Bearer '+key.token}
    const agent=async(name,input,status=200)=>{
      const r=await h.send('/api/strap/agent/command',{name,input},'',agentHeaders)
      assert.equal(r.status,status,r.text);return r.value.result??r.value
    }
    const context=await h.send('/api/strap/agent/context',undefined,'',agentHeaders)
    assert.equal(context.status,200,context.text)
    assert.doesNotMatch(context.text,/PRIVATE APPOINTMENT/)
    const source=context.value.demand.classes.find(c=>c.classId===full.id)
    assert.deepEqual([source.capacity,source.reserved,source.waiting,source.attended],[1,1,2,1])
    assert.equal(source.bookings.find(b=>b.id===booked.id).attendance,'attended')
    assert.equal(context.value.demand.classes.find(c=>c.classId===quiet.id).substitutions[0].id,subDraft.id)
    assert.equal(context.value.demand.availability.find(r=>r.id===unavailable.id).resourceId,cover.id)
    assert.equal((await h.state(ana.cookie)).demand,null)
    assert.equal((await h.state(original.cookie)).demand,null)
    const prepare=proposal=>agent('recommendation.prepare',proposal)
    const approve=d=>({id:d.id,impact:d.impact.key,notification:d.recommendation.notification})
    const denied=async(name,input,cookie,status=403)=>h.cmd(name,input,cookie,status)
    const sources=[full.id,quiet.id]
    const additional={action:'additional',sourceClassIds:sources,reason:'Morning Mat has two waiting; Quiet Mat has eight free seats. Add an available Mat class.',proposal:{...fields('Extra Mat',6,6),instructorId:cover.id}}
    const before=await h.state(),first=await prepare(additional)
    assert.equal((await h.state()).classes.length,before.classes.length,'preparing never publishes')
    assert.deepEqual(first.recommendation.evidence.map(c=>c.classId).sort(),sources.sort())
    assert.equal(first.recommendation.instructors.find(p=>p.instructorId===cover.id).available,true)
    assert.doesNotMatch(JSON.stringify(first),/PRIVATE APPOINTMENT/)
    await denied('recommendation.prepare',additional,ana.cookie)
    await denied('recommendation.approve',approve(first),original.cookie)
    await agent('recommendation.approve',approve(first),403)
    await denied('classes.publish',{id:first.id},h.owner,400)
    const changedAvailability=await h.cmd('scheduling.unavailable.save',{resourceKind:'instructor',resourceId:cover.id,start:at(6),end:at(7),reason:'Unavailable for proposed class'})
    const staleBefore=await h.state()
    assert.match((await denied('recommendation.approve',approve(first),h.owner,409)).error,/facts_changed/)
    assert.equal((await h.state()).version,staleBefore.version)
    assert.equal((await h.state()).drafts.find(d=>d.id===first.id).stale,true)
    if(process.env.STRAP_PROOF_DIR)await(await import('./demand-browser.mjs')).demandBrowser(h,{draft:first,stage:'stale',stale:true})
    await h.cmd('scheduling.unavailable.remove',{id:changedAvailability.id})
    const fresh=await prepare(additional)
    assert.notEqual(fresh.id,first.id)
    if(process.env.STRAP_PROOF_DIR)await(await import('./demand-browser.mjs')).demandBrowser(h,{draft:fresh,stage:'additional'})
    const added=await h.cmd('recommendation.approve',approve(fresh))
    assert.deepEqual(await h.cmd('recommendation.approve',approve(fresh)),added)
    assert.equal((await h.state()).classes.filter(c=>c.recommendationId===fresh.id).length,1)
    assert.equal((await h.state()).approvals.filter(a=>a.draftId===fresh.id).length,1)
    const retime={action:'retime',classId:full.id,sourceClassIds:sources,reason:'Test an earlier available time for the full class.',proposal:{start:at(-2),end:at(-1)}}
    let d=await prepare(retime)
    assert.deepEqual([d.impact.bookings,d.impact.creditsChanged,d.impact.moneyMoved],[3,0,0])
    await denied('recommendation.approve',{...approve(d),notification:'suppress'},h.owner,409)
    await denied('recommendation.approve',{...approve(d),impact:'altered'},h.owner,409)
    // An ordinary member booking after preparation invalidates the complete basis.
    const q=await h.cmd('booking.book',{classId:quiet.id},ben.cookie)
    await denied('recommendation.approve',approve(d),h.owner,409)
    d=await prepare(retime)
    if(process.env.STRAP_PROOF_DIR)await(await import('./demand-browser.mjs')).demandBrowser(h,{draft:d,stage:'retime'})
    const moneyBefore=await h.state(),mailBefore=mails.length
    await h.cmd('recommendation.approve',approve(d));await h.cmd('recommendation.approve',approve(d))
    const moved=await h.state()
    assert.equal(moved.classes.find(c=>c.id===full.id).start,at(-2))
    assert.deepEqual(moved.packs,moneyBefore.packs)
    assert.deepEqual(moved.packCreditEvents,moneyBefore.packCreditEvents)
    assert.deepEqual(moved.charges,moneyBefore.charges)
    assert.equal(mails.length-mailBefore,3)
    for(const p of [ana,ben,cara]) {
      const notice=(await h.state(p.cookie)).notices.filter(n=>n.seriesChangeId===d.id)
      assert.equal(notice.length,1)
      assert.equal(notice[0].body,d.impact.classes[0].bookings.find(b=>b.personId===p.id).body)
      assert.match(notice[0].body,/Brooklyn/)
    }
    assert.equal(moved.bookings.find(b=>b.id===booked.id).attendance,'attended')
    await h.cmd('substitution.qualification.save',{instructorId:original.id,service:'Mat',qualified:true,requestId:'morgan-mat'})
    const coverage={action:'coverage',classId:quiet.id,sourceClassIds:sources,reason:'Return the quiet class to its available original instructor.',proposal:{instructorId:original.id}}
    let coverDraft=await prepare(coverage)
    await h.cmd('substitution.qualification.save',{instructorId:original.id,service:'Mat',qualified:false,requestId:'morgan-revoked'})
    await denied('recommendation.approve',approve(coverDraft),h.owner,409)
    await agent('recommendation.prepare',coverage,409)
    await h.cmd('substitution.qualification.save',{instructorId:original.id,service:'Mat',qualified:true,requestId:'morgan-restored'})
    coverDraft=await prepare(coverage)
    if(process.env.STRAP_PROOF_DIR)await(await import('./demand-browser.mjs')).demandBrowser(h,{draft:coverDraft,stage:'coverage'})
    const priorMails=mails.length
    await h.cmd('recommendation.approve',approve(coverDraft));await h.cmd('recommendation.approve',approve(coverDraft))
    const final=await h.state(),covered=final.classes.find(c=>c.id===quiet.id)
    assert.equal(covered.instructorId,original.id);assert.equal(covered.substitutionHistory.length,2)
    assert.equal(covered.substitutionHistory[1].id,coverDraft.id)
    assert.equal(final.bookings.find(b=>b.id===q.id).classId,quiet.id)
    assert.equal(mails.length-priorMails,1)
    assert.equal(final.bookingActions.filter(a=>a.seriesChangeId===coverDraft.id).length,1)
    const exit=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    assert.ok(exit.tables.st_records.some(r=>r.id===coverDraft.id&&JSON.parse(r.data).status==='approved'))
    if(process.env.STRAP_PROOF_DIR)await(await import('./demand-browser.mjs')).demandBrowser(h,{stage:'published'})
  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-only-key'},outbound:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails');mails.push(await request.json());return Response.json({id:'demand_'+mails.length})
  }})
})

import assert from 'node:assert/strict'

/** Recorded historical contracts use the real HTTP doors, not a production clock override. */
export async function coolingOffCases(h){
  let sequence=800
  const key=()=>`synthetic-strap-${sequence++}`
  const hours=[1,2,3,4,5,6].map(day=>({day,opens:'09:00',closes:'17:00'}))
  await h.cmd('studio.save',{location:'Pasadena',timeZone:'America/Phoenix',businessHours:hours})
  const save=async(kind,row)=>h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run()
  const agreement=async({region='TX',amount=10000,acceptedAt='2026-01-05T09:00:00.000Z',deliveredAt=acceptedAt,renewal,intervalMonths=1}={})=>{
    const member=await h.person('Cooling'+sequence)
    const approved=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:10,amountCents:amount,expiresAt:'2099-12-31T00:00:00.000Z'})).id})
    let pack=(await h.state()).packs.find(p=>p.id===approved.id)
    const preview=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths,requestId:key()})
    const terms=await h.cmd('plan.recurring.accept',{id:preview.id,key:preview.key},member.cookie)
    await save('recurringTerms',{...terms,acceptedAt})
    await h.cmd('contract.jurisdiction.save',{personId:member.id,region,evidenceReference:key()})
    let contract=(await h.state()).cancellations.contracts.find(t=>t.id===terms.id)
    if(deliveredAt)await h.cmd('contract.copy.delivery.record',{termsId:terms.id,digest:contract.copy.digest,deliveredAt,evidenceReference:key(),requestId:key()})
    if(renewal){
      pack={...pack,termStartAt:renewal,createdAt:renewal,invoiceId:key()};await save('pack',pack)
      const invoice={id:pack.invoiceId,personId:member.id,packId:pack.id,recurringTermsId:terms.id,dueAt:renewal,amountCents:amount,status:'open'}
      await h.db.prepare('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,0)').bind(invoice.id,'recurringInvoice',JSON.stringify(invoice)).run()
      const receipt=await h.cmd('payment.record',{personId:member.id,amountCents:amount,reference:key()})
      const charge=(await h.state()).charges.find(c=>c.packId===pack.id&&c.amountCents===amount)
      await h.cmd('contract.prepayment.record',{packId:pack.id,paymentId:receipt.id,chargeId:charge.id,amountCents:amount,reference:key()})
    }
    contract=(await h.state(member.cookie)).cancellations.contracts.find(t=>t.id===terms.id)
    return {member,pack,terms,window:contract.coolingOff}
  }
  const cancel=async(a,at,ok=true)=>h.cmd('plan.cancellation.statutory',{packId:a.pack.id,reasonCode:'cooling-off',documentedAt:at,evidenceReference:key(),requestId:key()},a.member.cookie,ok?200:409)
  const ga=await agreement({region:'GA'});assert.equal(ga.window.deadline,'2026-01-15T07:00:00.000Z');assert.equal(ga.window.governingRule.id,'GA-10-1-393.2')
  assert.equal((await cancel(ga,'2026-01-14T12:00:00.000Z')).status,'applied')
  assert.equal((await cancel(await agreement({region:'GA'}),'2026-01-15T12:00:00.000Z',false)).error,'cooling_off_window_ended')
  const ca=await agreement({region:'CA',amount:260000});assert.equal(ca.window.deadline,'2026-03-12T07:00:00.000Z');assert.equal((await cancel(ca,'2026-03-11T12:00:00.000Z')).status,'applied')
  assert.equal((await cancel(await agreement({region:'CA',amount:260000}),'2026-03-12T12:00:00.000Z',false)).error,'cooling_off_window_ended')
  const small=await agreement({region:'CA',amount:149900});assert.equal(small.window.rules.find(r=>r.id==='CA-1812.85-b').deadline,'2026-01-11T07:00:00.000Z');assert.ok(!small.window.rules.some(r=>r.id==='CA-1812.85-d'));assert.equal(small.window.deadline,'2026-01-13T07:00:00.000Z','the weekday owner floor can lengthen the studio-open rule')
  const delayed=await agreement({deliveredAt:'2026-01-07T09:00:00.000Z'});assert.equal(delayed.window.opensAt,'2026-01-07T09:00:00.000Z');assert.equal(delayed.window.deadline,'2026-01-15T07:00:00.000Z')
  const missing=await agreement({deliveredAt:null});assert.equal(missing.window.deadline,null);assert.equal((await cancel(missing,'2026-03-06T12:00:00.000Z')).status,'applied','no recorded copy delivery: day 60 remains timely')
  for(const [months,inside,outside] of [[12,'2026-01-27T12:00:00.000Z','2026-01-28T12:00:00.000Z'],[1,'2026-01-08T12:00:00.000Z','2026-01-09T12:00:00.000Z']]){
    const options={region:'NY',acceptedAt:'2025-01-06T09:00:00.000Z',deliveredAt:'2025-01-06T09:00:00.000Z',renewal:'2026-01-05T09:00:00.000Z',intervalMonths:months}
    const renewed=await agreement(options),ended=await cancel(renewed,inside)
    const refund=(await h.state()).cancellations.refunds.find(r=>r.cancellationId===ended.id)
    assert.equal(refund.amountCents,10000,'the timely NY renewal cancellation refunds that renewal in full');assert.ok(refund.settleBy);assert.equal(ended.coolingOff.renewal.invoiceId,renewed.pack.invoiceId)
    assert.equal((await cancel(await agreement(options),outside,false)).error,'cooling_off_window_ended')
  }
  await h.cmd('studio.save',{businessHours:[...hours.filter(r=>r.day<6).map(r=>({...r,closes:'15:00'})),hours[5]]})
  const nj=await agreement({region:'NJ'});assert.equal(nj.window.deadline,'2026-01-25T07:00:00.000Z','six-hour weekdays never consume an eight-hour operating day')
  await h.cmd('studio.save',{businessHours:[hours[5],{day:7,opens:'09:00',closes:'17:00'}]})
  const weekend=await agreement({region:'TX'});assert.equal(weekend.window.deadline,'2026-02-08T07:00:00.000Z','five open Saturdays give the weekend-only studio a finite cutoff')
  await h.cmd('studio.save',{businessHours:hours})
  await h.cmd('plan.cancellation.policy.save',{coolingOffDays:4,relocationMiles:25},h.owner,400)
  await h.cmd('plan.cancellation.policy.save',{coolingOffDays:10,relocationMiles:25})
  assert.equal((await agreement()).window.deadline,'2026-01-21T07:00:00.000Z','a larger owner setting lengthens the window and excludes MLK Day')
  assert.equal((await agreement({region:'CA',amount:260000})).window.deadline,'2026-03-12T07:00:00.000Z','an owner setting never shortens a state rule')
  await h.cmd('plan.cancellation.policy.save',{coolingOffDays:5,relocationMiles:25})
  const holiday=await agreement({acceptedAt:'2026-07-02T09:00:00.000Z'});assert.equal(holiday.window.deadline,'2026-07-11T07:00:00.000Z','observed July 4 on Friday July 3 does not count')
  const mailed=await agreement({region:'GA'});assert.equal((await cancel(mailed,'2026-01-14T23:59:00.000Z')).status,'applied','recording a mailed request after cutoff preserves its documented timely send date')
  return {ga:await agreement({region:'GA'}),gaMobile:await agreement({region:'GA'}),ca:await agreement({region:'CA',amount:260000}),delayed,weekend,nj,holiday}
}

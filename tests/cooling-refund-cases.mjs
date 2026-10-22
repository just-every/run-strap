import assert from 'node:assert/strict'

/** Public sales, receipts, allocations and cancellations; only historical clock facts are fixtures. */
export async function coolingRefundCases(h) {
  let sequence=1400
  const key=()=>`synthetic-strap-${sequence++}`
  const start='2026-01-05T07:00:00.000Z', day=86_400_000
  const plus=(at,days)=>new Date(Date.parse(at)+days*day).toISOString()
  const save=async(kind,row)=>h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run()
  const policy=async(coolingDeductions={})=>h.cmd('plan.cancellation.policy.save',{coolingOffDays:5,relocationMiles:25,coolingDeductions})
  await h.cmd('studio.save',{location:'Pasadena',timeZone:'America/Phoenix',businessHours:[1,2,3,4,5,6].map(day=>({day,opens:'09:00',closes:'17:00'}))})
  await policy()
  const agreement=async({region='NY',amountCents=5900,initiationFeeCents=19900,days=30,unlimited=false,serviceVisits=0}={})=>{
    const member=await h.person(key())
    const prepared=await h.cmd('pack.prepare',{personId:member.id,amountCents,initiationFeeCents,expiresAt:'2099-01-05T07:00:00.000Z',...(unlimited?{kind:'unlimited'}:{credits:10})})
    const approved=await h.cmd('pack.approve',{id:prepared.id})
    let state=await h.state(),pack=state.packs.find(p=>p.id===approved.id)
    const saleCharges=state.charges.filter(c=>c.packId===pack.id)
    assert.equal(saleCharges.reduce((n,c)=>n+c.amountCents,0),amountCents+initiationFeeCents)
    if(initiationFeeCents)assert.equal(saleCharges.find(c=>c.reason==='initiation_fee').amountCents,initiationFeeCents,'the initiation fee has its own real sale charge')
    const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:key()})
    const terms=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie)
    const receipt=await h.cmd('payment.record',{personId:member.id,amountCents:amountCents+initiationFeeCents,reference:key()})
    for(const charge of saleCharges)await h.cmd('contract.prepayment.record',{packId:pack.id,paymentId:receipt.id,chargeId:charge.id,amountCents:charge.amountCents,reference:key()})
    if(serviceVisits){
      const instructor=await h.person(key(),'instructor')
      for(let i=0;i<serviceVisits;i++){
        const future=plus(new Date().toISOString(),i+2),d=new Date(future)
        const week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
        const published=await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:'Mat practice',room:key(),start:future,end:new Date(Date.parse(future)+3_600_000).toISOString(),capacity:2,instructorId:instructor.id}]})).id})
        const entry=published.classes[0],booking=await h.cmd('booking.book',{classId:entry.id},member.cookie)
        const attended=await h.cmd('attendance.checkin',{id:booking.id})
        const historicalStart=plus(start,i+.25)
        await save('class',{...entry,start:historicalStart,end:new Date(Date.parse(historicalStart)+3_600_000).toISOString(),localDate:historicalStart.slice(0,10)})
        await save('booking',{...attended,checkedInAt:historicalStart})
        const valuation={bookingId:booking.id,amountCents:4000,evidenceReference:key()}
        const value=await h.cmd('contract.service-value.record',valuation)
        assert.deepEqual(await h.cmd('contract.service-value.record',valuation),value,'actual service valuation is immutable evidence with exact replay')
        await h.cmd('contract.service-value.record',{...valuation,amountCents:5000},h.owner,409)
      }
      pack=(await h.state()).packs.find(p=>p.id===pack.id)
    }
    // Historical evidence uses the same persisted-history convention as cooling-off-cases.
    pack={...pack,termStartAt:start,createdAt:start,expiresAt:plus(start,days)}
    await save('pack',pack);await save('recurringTerms',{...terms,acceptedAt:start})
    await h.cmd('contract.jurisdiction.save',{personId:member.id,region,evidenceReference:key()})
    const contract=(await h.state()).cancellations.contracts.find(t=>t.id===terms.id)
    await h.cmd('contract.copy.delivery.record',{termsId:terms.id,digest:contract.copy.digest,deliveredAt:start,evidenceReference:key(),requestId:key()})
    return {member,pack,terms,receipt,total:amountCents+initiationFeeCents}
  }
  const cancel=async(a,at=plus(start,1),reasonCode='cooling-off')=>{
    const input={packId:a.pack.id,reasonCode,documentedAt:at,evidenceReference:key(),requestId:key()}
    const applied=await h.cmd('plan.cancellation.statutory',input,a.member.cookie)
    assert.equal(applied.status,'applied')
    const state=await h.state(),refund=state.cancellations.refunds.find(r=>r.cancellationId===applied.id)
    assert.ok(refund,'the actual cancellation retains a refund due')
    assert.equal(refund.status,'refund_due');assert.equal(refund.settledCents,0)
    assert.equal(state.cancellations.settlements.filter(s=>s.refundId===refund.id).length,0,'recording a refund due moves no funds')
    assert.equal(state.payments.filter(p=>p.personId===a.member.id).length,1,'the original external receipt remains the only payment')
    assert.equal(refund.settleBy,applied.refundDeadline.settleBy)
    assert.equal(refund.settleBy,applied.refundDeadline.rules.map(r=>r.deadline).filter(Boolean).sort()[0],'the shortest applicable settlement deadline governs')
    assert.deepEqual(await h.cmd('plan.cancellation.statutory',input,a.member.cookie),applied,'replay keeps the same cancellation and refund identity')
    return {applied,refund,state}
  }

  const ny=await agreement()
  // An issued but unpaid future installment is retained historical invoice evidence.
  // Its debt is created through the ordinary pack sale, never invented as a test balance.
  const futureSale=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:ny.member.id,credits:10,amountCents:5900,expiresAt:'2099-02-05T07:00:00.000Z'})).id})
  let state=await h.state(),futurePack=state.packs.find(p=>p.id===futureSale.id),futureCharge=state.charges.find(c=>c.packId===futurePack.id)
  const invoiceId=key(),dueAt=plus(start,10)
  await save('pack',{...futurePack,termStartAt:dueAt,createdAt:dueAt,expiresAt:plus(dueAt,30),recurringTermsId:ny.terms.id,invoiceId})
  await save('charge',{...futureCharge,invoiceId,recurringTermsId:ny.terms.id,kind:'recurring-invoice'})
  await h.db.prepare('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,0)').bind(invoiceId,'recurringInvoice',JSON.stringify({id:invoiceId,personId:ny.member.id,packId:futurePack.id,previousPackId:ny.pack.id,recurringTermsId:ny.terms.id,dueAt,termEndAt:plus(dueAt,30),amountCents:5900,chargeId:futureCharge.id,status:'open',collection:'studio-balance-only',createdAt:start})).run()
  const ended=await cancel(ny)
  assert.equal(ended.refund.amountCents,25800,'NY cooling-off returns the receipt-backed $199 initiation fee and $59 membership in full')
  const voided=ended.state.recurring.invoices.find(i=>i.id===invoiceId)
  assert.equal(voided.status,'void');assert.equal(voided.voidedUnpaidCents,5900)
  const reversals=ended.state.charges.filter(c=>c.reversesChargeId===futureCharge.id)
  assert.equal(reversals.length,1);assert.equal(reversals[0].amountCents,-5900)
  assert.equal(ended.state.balances.find(b=>b.personId===ny.member.id).balanceCents,0,'the future unpaid debt is void while the paid sale waits for external refund settlement')

  for(const region of ['GA','FL','CA']){
    const sale=await agreement({region}),result=await cancel(sale)
    assert.equal(result.refund.amountCents,sale.total,`${region} defaults to refunding all allocated money, including initiation fees`)
  }

  await policy({GA:true})
  const georgia=await agreement({region:'GA',serviceVisits:3}),ga=await cancel(georgia,plus(start,3))
  assert.equal(ga.refund.amountCents,15800,'GA opts into the $100 cap on three documented $40 services, retaining $100 rather than $120')

  await policy({FL:true})
  const florida=await agreement({region:'FL',amountCents:9000,initiationFeeCents:0,unlimited:true})
  const fl=await cancel(florida,plus(start,3.5))
  assert.equal(fl.refund.amountCents,8100,'FL opts into $90 × 3 complete elapsed days / 30 term days; the partial fourth day is not deducted')

  await policy({CA:true})
  const california=await agreement({region:'CA',amountCents:250100,initiationFeeCents:19900,days:45,unlimited:true})
  const ca=await cancel(california,plus(start,30))
  assert.equal(ca.refund.amountCents,90000,'CA(d) on day 30 of 45 returns the unused 15/45 of all $2,700 paid')

  await policy()
  const death=await agreement({region:'NY',amountCents:30000,initiationFeeCents:0,days:30,unlimited:true})
  const deceased=await cancel(death,plus(start,10),'death')
  assert.equal(deceased.refund.amountCents,20000,'death retains the unused-time valuation rather than the cooling-off full-refund default')
  return {ny,ended,georgia,ga,florida,fl,california,ca,death,deceased}
}

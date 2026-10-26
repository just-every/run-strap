import assert from 'node:assert/strict'
import { assertFinanceDownloads } from './finance-downloads.mjs'

/** Unsupported cancellation allocations remain signed source facts, never ordinary deferred refunds. */
export async function financeExclusions(h,{cmd,state,read,jump,buy,key,people,coach,publish}) {
  const cases=[]
  for(const [name,initiationFeeCents] of [['Mixed consideration',0],['Initiation fee',500],['Excess refund',0],['Cooling off',0]]) {
    const member=await h.person(name.replaceAll(' ',''));people.push(member)
    const sale=await buy({personId:member.id,kind:'credits',credits:10,amountCents:31000,initiationFeeCents,expiresAt:'2032-06-01T07:00:00Z',planName:name})
    const receipt=await cmd('payment.record',{personId:member.id,amountCents:31000+initiationFeeCents,reference:key()})
    for(const charge of (await state()).charges.filter(c=>c.packId===sale.pack.id))await cmd('contract.prepayment.record',{packId:sale.pack.id,paymentId:receipt.id,chargeId:charge.id,amountCents:charge.amountCents,reference:key()})
    const proposal=await cmd('plan.recurring.prepare',{packId:sale.pack.id,intervalMonths:1,requestId:key()})
    await cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie)
    cases.push({name,member,sale,bookings:[],initiationFeeCents})
  }
  const mixed=cases[0]
  const freezeType=await cmd('freeze.type.save',{name:'Paid travel leave',reason:'Member requested leave',feeCents:1500,defaultLengthDays:2,maxLengthDays:5})
  const freeze=await cmd('freeze.prepare',{packId:mixed.sale.pack.id,freezeTypeId:freezeType.id,startAt:'2032-05-10',endAt:'2032-05-12',requestId:key(),channel:'desk'})
  await cmd('freeze.accept',{id:freeze.id,key:freeze.key},mixed.member.cookie)
  await cmd('freeze.confirm',{id:freeze.id,key:freeze.key,requestId:key(),channel:'desk'})
  for(let i=0;i<9;i++){
    const entry=await publish(`2032-05-03T${String(8+i).padStart(2,'0')}:00:00Z`,`Exclusion service ${i+1}`)
    for(const scenario of (i===0?cases.slice(0,3):[cases[2]])){
      const booking=await cmd('booking.book',{classId:entry.id},scenario.member.cookie)
      assert.equal(booking.packId,scenario.sale.pack.id)
      await cmd('attendance.checkin',{id:booking.id},coach.cookie);scenario.bookings.push(booking)
    }
  }
  await jump('2032-05-04T07:00:00Z')
  const cooling=cases[3]
  const canceled=await cmd('plan.cancellation.statutory',{packId:cooling.sale.pack.id,reasonCode:'cooling-off',documentedAt:'2032-05-04T07:00:00Z',evidenceReference:key(),requestId:key()},cooling.member.cookie)
  assert.equal(canceled.status,'applied')
  cooling.cancellation=canceled
  // Let the paid freeze finish before ordinary termination, preserving its separate fee.
  await jump('2032-05-13T07:00:00Z');await(await h.mf.getWorker()).scheduled()
  for(const scenario of cases.slice(0,3)){
    const cancellation=await cmd('plan.cancellation.prepare',{packId:scenario.sale.pack.id,effectiveAt:'2032-05-20T07:00:00Z',reason:'End membership early',exceptionReason:'Record unused prepaid refund externally',requestId:key(),channel:'desk'})
    scenario.cancellation=await cmd('plan.cancellation.confirm',{id:cancellation.id,key:cancellation.key,requestId:key(),channel:'desk'})
  }
  await jump('2032-05-21T07:00:00Z');await(await h.mf.getWorker()).scheduled()
  const snapshot=await state(),before=await read('2032-05')
  for(const scenario of cases){
    const {sale,member,name}=scenario,due=snapshot.cancellations.refunds.find(r=>r.packId===sale.pack.id)
    assert.ok(due&&due.amountCents>0,`${name}: a real cancellation retains a known refund`)
    scenario.due=due
    const original=before.rows.find(r=>r.id===sale.charge.id),refund=before.rows.find(r=>r.id===due.id)
    assert.deepEqual([original.amountCents,original.earnedCents,original.deferredCents,original.unusedPackCents,original.unclassifiedCents],[31000,0,0,0,31000],`${name}: unsupported original consideration stays unclassified`)
    assert.deepEqual([refund.amountCents,refund.earnedCents,refund.deferredCents,refund.unusedPackCents,refund.unclassifiedCents],[-due.amountCents,0,0,0,-due.amountCents],`${name}: excluded refund never reduces ordinary deferred value`)
    assert.deepEqual([original.serviceStart,original.serviceEnd],[sale.pack.createdAt,sale.draft.expiresAt],`${name}: original accepted interval survives termination`)
    assert.deepEqual([refund.serviceStart,refund.serviceEnd],[due.valuationPack.termStartAt??due.valuationPack.createdAt,due.valuationPack.expiresAt])
    assert.equal(before.sources.find(s=>s.id===sale.charge.id).amountCents,31000)
    assert.equal(before.sources.find(s=>s.id===due.id).amountCents,-due.amountCents)
    assert.equal(before.sources.find(s=>s.id===due.id).record.cancellationId,scenario.cancellation.id)
    const retained=snapshot.packs.find(p=>p.id===sale.pack.id)
    assert.equal(retained.remaining,10-scenario.bookings.length,`${name}: refund does not erase retained credit movements`)
    assert.equal(retained.expiresAt,scenario.cancellation.effectiveAt)
    assert.deepEqual(retained.entitlement,sale.pack.entitlement)
    assert.equal(snapshot.payments.filter(p=>p.personId===member.id).length,1,'recording refund due creates no payment')
  }
  const fee=snapshot.charges.find(c=>c.freezeId===freeze.id)
  assert.equal(fee.amountCents,1500)
  assert.equal(before.rows.find(r=>r.id===fee.id).unclassifiedCents,1500,'mixed fee retains its own positive source row')
  const initiation=snapshot.charges.find(c=>c.packId===cases[1].sale.pack.id&&c.reason==='initiation_fee')
  assert.equal(initiation.amountCents,500)
  assert.equal(before.rows.find(r=>r.id===initiation.id).unclassifiedCents,500,'initiation fee remains separately unclassified')
  assert.ok(cases[2].due.amountCents>3100,'nine delivered visits leave only 3100 cents unearned, below this time-valued refund')
  assert.equal(cooling.due.amountCents,31000,'cooling-off returns full allocated consideration even with no delivered service')
  assert.ok(cooling.due.coolingOptions,'cooling-off allocation is explicitly retained')
  assert.equal(before.closing.refundPayableCents,snapshot.cancellations.refunds.reduce((n,r)=>n+(r.amountCents??0)-r.settledCents,0))
  const input={id:mixed.due.id,payerId:mixed.member.id,amountCents:700,reference:key(),settledAt:new Date(Date.now()-1000).toISOString()}
  const settlement=await cmd('plan.cancellation.refund.settle',input)
  assert.deepEqual(await cmd('plan.cancellation.refund.settle',input),settlement)
  const after=await read('2032-05')
  assert.deepEqual(after.rows,before.rows,'external settlement and replay preserve every recognition source and classification')
  assert.equal(after.closing.cashCents,before.closing.cashCents-700)
  assert.equal(after.closing.refundPayableCents,before.closing.refundPayableCents-700)
  assert.equal(after.closing.receivableCents,before.closing.receivableCents)
  assert.equal(after.closing.reconciliationDifferenceCents,0)
  assert.equal(after.sources.filter(s=>s.id===settlement.id).length,1)
  assert.equal(after.sources.find(s=>s.id===settlement.id).amountCents,-700)
  await assertFinanceDownloads(h,h.owner,after)
  if(process.env.STRAP_PROOF_DIR)await(await import('./finance-browser.mjs')).financeBrowser(h,{report:after,month:'2032-05',prefix:'exclusions',sourceId:mixed.due.id})
}

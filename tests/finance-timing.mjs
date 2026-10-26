import assert from 'node:assert/strict'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { run } from './harness.mjs'
import { totp } from './mfa-helpers.mjs'
import { parseCsv } from './report-downloads.mjs'

const day=86_400_000
const halfUp=(amount,n,d)=>Number((2n*BigInt(amount)*BigInt(n)+BigInt(d))/(2n*BigInt(d)))
const monday=at=>{const d=new Date(at);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}

/** Original accepted sales survive elapsed months; only the isolated process clock moves. */
export async function financeTiming() {
  const path=process.env.STRAP_RECOVERY_CLOCK
  assert.ok(path,'Run through scripts/finance-journey.mjs')
  const original=await readFile(path,'utf8');let offset=Number(original)
  try {await run(async h=>{
    let owner=h.owner,sequence=8000
    const key=()=>`synthetic-strap-${sequence++}`
    const cmd=(name,input,cookie=owner,status=200)=>h.cmd(name,input,cookie,status)
    const state=()=>h.state(owner)
    const people=[]
    const jump=async target=>{
      offset=Math.ceil((Date.parse(target)-(Date.now()-offset*1000))/1000)
      await writeFile(path+'.new',String(offset));await rename(path+'.new',path)
      owner=await h.signIn('owner@studio.example');h.owner=owner
      await cmd('mfa.verify',{code:totp(h.mfaOwner.secret)})
      for(const person of people)person.cookie=await h.signIn(person.email)
    }
    await h.confirmSetup(owner)
    for(const ext of ['', '.csv','.xlsx'])assert.equal((await h.send('/api/strap/reports/finance'+ext,undefined,owner)).status,403)
    h.mfaOwner=await h.enroll(owner)
    await cmd('studio.save',{location:'Desert studio',timeZone:'America/Phoenix'})
    const member=await h.person('Nora'),coach=await h.person('Maya','instructor'),refundedMember=await h.person('Ruby');people.push(member,coach,refundedMember)
    const buy=async extra=>{
      const draft=await cmd('pack.prepare',{personId:member.id,amountCents:120001,kind:'unlimited',planName:'Annual studio',expiresAt:'2033-01-01T07:00:00Z',...extra})
      const approved=await cmd('pack.approve',{id:draft.id})
      const pack=(await state()).packs.find(p=>p.id===approved.id)
      return {draft,pack,charge:(await state()).charges.find(c=>c.packId===pack.id&&!c.reason)}
    }
    const annual=await buy({}),ten=await buy({kind:'credits',credits:10,planName:'Ten pack',amountCents:20001,expiresAt:'2032-06-01T07:00:00Z'})
    assert.ok(Math.abs(Date.parse(annual.draft.expiresAt)-Date.parse(annual.pack.createdAt)-366*day)<60_000,'accepted sale is an annual interval')
    for(const sale of [annual,ten])await cmd('payment.record',{personId:member.id,amountCents:sale.draft.amountCents,reference:key()})
    const gift=await cmd('retail.gift.issue',{personId:member.id,recipientId:member.id,amountCents:10001,tender:'external',reference:key(),locationId:'studio',requestId:key()})
    const supplier=await cmd('retail.supplier.add',{name:'Mat supplier',reference:key(),requestId:key()})
    const sku=await cmd('retail.sku.add',{supplierId:supplier.id,sku:'MAT',barcode:key(),name:'Practice mat',variant:'Standard',priceCents:2000,lowStock:0,requestId:key()})
    await cmd('retail.receive',{skuId:sku.id,quantity:2,locationId:'studio',reference:key(),requestId:key()})
    const retail=await cmd('retail.sell',{personId:member.id,skuId:sku.id,locationId:'studio',quantity:1,expectedCents:2000,tender:'gift',giftCardId:gift.id,reference:key(),requestId:key()})
    await cmd('bookingRule.save',{cancelCutoffHours:500,lateCancelReturnsCredit:false,noShowFeeCents:700,lateCancelFeeCents:500})
    const publish=async (date,title)=> (await cmd('classes.publish',{id:(await cmd('classes.prepare',{week:monday(date),classes:[{title,start:date,end:new Date(Date.parse(date)+3_600_000).toISOString(),capacity:4,room:title,instructorId:coach.id}]})).id})).classes[0]
    const attended=await publish('2032-01-15T17:00:00Z','Mat attended'),missed=await publish('2032-01-16T17:00:00Z','Mat missed'),forfeited=await publish('2032-01-17T17:00:00Z','Mat forfeited')
    const bookings=[]
    for(const entry of [attended,missed,forfeited])bookings.push(await cmd('booking.book',{classId:entry.id},member.cookie))
    assert.ok(bookings.every(b=>b.packId===ten.pack.id),'finite ten-pack funds the visits')
    const read=async month=>{const r=await h.send('/api/strap/reports/finance?financeMonth='+month,undefined,owner);assert.equal(r.status,200,r.text);return r.value}
    const finite=report=>report.rows.find(r=>r.id===ten.charge.id)
    assert.equal(finite(await read('2032-01')).earnedCents,0,'reservations earn nothing')
    await cmd('attendance.checkin',{id:bookings[0].id},coach.cookie)
    assert.equal(finite(await read('2032-01')).earnedCents,0,'early check-in earns nothing')
    await jump('2032-01-15T17:30:00Z')
    assert.equal(finite(await read('2032-01')).earnedCents,0,'service in progress earns nothing')
    await jump('2032-01-16T17:01:00Z')
    await cmd('attendance.noshow',{id:bookings[1].id},coach.cookie)
    const terms=(await h.state(member.cookie)).bookings.find(b=>b.id===bookings[2].id).cancelEffect.key
    await cmd('booking.cancel',{id:bookings[2].id,terms},member.cookie)
    const current=(await state()).packs.find(p=>p.id===ten.pack.id)
    await cmd('pack.adjust',{id:current.id,revision:current.creditRevision,creditsDelta:-1,reason:'Owner corrects an unused promotional credit',requestId:key()})
    assert.equal(finite(await read('2032-01')).earnedCents,2000,'only the completed attended service earns original pack value')
    await jump('2032-02-01T07:01:00Z')
    const jan=await read('2032-01'),end=Date.parse('2032-02-01T07:00:00Z'),from=Date.parse(annual.pack.createdAt),duration=Date.parse(annual.draft.expiresAt)-from
    assert.equal(jan.rows.find(r=>r.id===annual.charge.id).earnedCents,halfUp(120001,end-from,duration))
    assert.deepEqual([finite(jan).earnedCents,finite(jan).deferredCents,finite(jan).unusedPackCents],[2000,18001,18001])
    assert.deepEqual(finite(jan).consumedBookingIds,[bookings[0].id])
    assert.equal(jan.closing.cashCents,150003)
    assert.equal(jan.closing.noncashGiftTenderCents,2000)
    assert.equal(jan.closing.giftLiabilityCents,8001)
    assert.equal(jan.closing.unclassifiedCents,1200,'no-show and forfeiture fees stay visible and unclassified')
    assert.equal(jan.sources.find(s=>s.id===retail.paymentId).kind,'gift-tender')
    await jump('2032-02-05T17:00:00Z')
    const fundingRefund={giftCardId:gift.id,amountCents:3001,reason:'Unused gift funding returned externally',reference:key(),requestId:key()}
    const returned=await cmd('retail.gift.refund',fundingRefund);assert.deepEqual(await cmd('retail.gift.refund',fundingRefund),returned)
    await jump('2032-03-01T07:01:00Z')
    const feb=await read('2032-02')
    assert.deepEqual(feb.opening,jan.closing)
    const annualFeb=feb.rows.find(r=>r.id===annual.charge.id)
    const cumulative=halfUp(120001,Date.parse('2032-03-01T07:00:00Z')-from,duration)
    assert.equal(annualFeb.earnedCents,cumulative)
    assert.equal(feb.period.earnedCents,cumulative-jan.rows.find(r=>r.id===annual.charge.id).earnedCents,'monthly earned uses cumulative endpoint differences')
    assert.deepEqual([feb.period.cashCents,feb.closing.giftLiabilityCents],[-3001,5000])
    for(const report of [jan,feb]){
      const t=report.closing
      assert.equal(t.reconciliationDifferenceCents,0)
      assert.equal(t.cashCents+t.receivableCents,t.earnedCents+t.deferredCents+t.giftLiabilityCents+t.unclassifiedCents+t.refundPayableCents)
      assert.equal(t.serviceInvoiceCents,t.earnedCents+t.deferredCents+t.unclassifiedCents)
      assert.equal(report.taxCents,null,'tax is unavailable, never assumed zero')
    }
    for(const sale of [annual,ten]){
      const saved=JSON.parse((await h.db.prepare('SELECT data FROM st_records WHERE id=?').bind(sale.draft.id).first()).data)
      assert.equal(saved.expiresAt,sale.draft.expiresAt);assert.equal(saved.amountCents,sale.draft.amountCents);assert.equal(saved.credits,sale.draft.credits)
      const row=feb.rows.find(r=>r.id===sale.charge.id)
      assert.equal(row.serviceStart,sale.pack.createdAt);assert.equal(row.serviceEnd,sale.draft.expiresAt)
    }
    await assertDownloads(h,owner,feb)
    if(process.env.STRAP_PROOF_DIR)await(await import('./finance-browser.mjs')).financeBrowser(h,{report:feb,month:'2032-02'})
    await adjustments(h,{cmd,state,read,jump,buy,key,member,coach,refundedMember,people,ten,annual,bookings})
  },{mfa:false})} finally {await writeFile(path+'.new',original);await rename(path+'.new',path)}
}

async function assertDownloads(h,owner,report) {
  const path='/api/strap/reports/finance',query='?financeMonth='+report.month
  const csv=await h.send(path+'.csv'+query,undefined,owner);assert.equal(csv.status,200)
  const [columns,...rows]=parseCsv(csv.text),objects=rows.map(row=>Object.fromEntries(columns.map((k,i)=>[k,row[i]??null])))
  for(const row of objects.filter(r=>r.kind==='metric'))assert.deepEqual([row.openingCents,row.periodCents,row.closingCents],[report.opening[row.id],report.period[row.id],report.closing[row.id]])
  for(const source of report.sources){
    assert.ok(objects.some(r=>r.id===source.id&&r.amountCents===source.amountCents))
    const detail=await h.send(source.sourceUrl,undefined,owner);assert.equal(detail.status,200);assert.ok(detail.text.includes(source.id))
  }
  const sheet=await h.mf.dispatchFetch(h.origin+path+'.xlsx'+query,{headers:{cookie:owner}})
  const readXlsx=(await import('read-excel-file/node')).default
  const sheets=await readXlsx(Buffer.from(await sheet.arrayBuffer()))
  for(const [metric,opening,period,closing] of sheets.find(s=>s.sheet==='Reconciliation').data.slice(1))assert.deepEqual([opening,period,closing],[report.opening[metric],report.period[metric],report.closing[metric]])
}

async function adjustments(h,{cmd,state,read,jump,buy,key,member,coach,refundedMember,people,ten,annual,bookings}) {
  const freezeType=await cmd('freeze.type.save',{name:'Travel',reason:'Agreed leave',feeCents:1234,defaultLengthDays:5,maxLengthDays:30})
  const preview=await cmd('freeze.prepare',{packId:ten.pack.id,freezeTypeId:freezeType.id,startAt:'2032-03-15',endAt:'2032-03-20',requestId:key(),channel:'desk'})
  assert.equal((await read('2032-03')).rows.find(r=>r.id===ten.charge.id).earnedCents,2000,'an unconfirmed freeze never changes recognition')
  await cmd('freeze.accept',{id:preview.id,key:preview.key},member.cookie)
  await cmd('freeze.confirm',{id:preview.id,key:preview.key,requestId:key(),channel:'desk'})
  const expirySale=await buy({kind:'credits',credits:10,amountCents:10003,expiresAt:'2032-06-01T07:00:00Z'})
  const changed=await buy({kind:'credits',credits:10,amountCents:10000,expiresAt:'2032-04-01T07:00:00Z'})
  const change=await cmd('plan.change.prepare',{packId:changed.pack.id,mode:'now',credits:8,amountCents:8000,effectiveAt:'2032-03-10T07:00:00Z',exceptionReason:'Member chooses fewer visits',requestId:key(),channel:'desk'})
  await cmd('plan.change.accept',{id:change.id,key:change.key},member.cookie)
  const refundSale=await buy({personId:refundedMember.id,kind:'credits',credits:10,amountCents:31000,expiresAt:'2032-04-01T07:00:00Z'})
  const receipt=await cmd('payment.record',{personId:refundedMember.id,amountCents:31000,reference:key()})
  await cmd('contract.prepayment.record',{packId:refundSale.pack.id,paymentId:receipt.id,chargeId:refundSale.charge.id,amountCents:31000,reference:key()})
  const proposal=await cmd('plan.recurring.prepare',{packId:refundSale.pack.id,intervalMonths:1,requestId:key()})
  await cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},refundedMember.cookie)
  const cancellation=await cmd('plan.cancellation.prepare',{packId:refundSale.pack.id,effectiveAt:'2032-03-20T07:00:00Z',reason:'Leave the studio early',exceptionReason:'Unused period will be refunded',requestId:key(),channel:'desk'})
  await cmd('plan.cancellation.confirm',{id:cancellation.id,key:cancellation.key,requestId:key(),channel:'desk'})
  await jump('2032-03-21T07:00:00Z')
  await(await h.mf.getWorker()).scheduled()
  const due=(await state()).cancellations.refunds.find(r=>r.packId===refundSale.pack.id)
  assert.ok(due.amountCents>0&&due.amountCents<31000,'partial service-purchase refund retains the original accepted price and interval')
  const before=await read('2032-03')
  assert.equal(before.closing.refundPayableCents,due.amountCents)
  assert.equal(before.sources.find(r=>r.id===due.id).record.amountCents,due.amountCents,'source is the exact retained refund due')
  const settlementInput={id:due.id,payerId:refundedMember.id,amountCents:1000,reference:key(),settledAt:new Date(Date.now()-1000).toISOString()}
  const settlement=await cmd('plan.cancellation.refund.settle',settlementInput);assert.deepEqual(await cmd('plan.cancellation.refund.settle',settlementInput),settlement)
  const after=await read('2032-03')
  assert.equal(after.closing.cashCents,before.closing.cashCents-1000)
  assert.equal(after.closing.refundPayableCents,due.amountCents-1000)
  assert.equal(after.closing.refundSettledCents,1000)
  assert.equal(after.closing.receivableCents,before.closing.receivableCents,'recorded refund never invents a new invoice receivable')
  assert.equal(after.sources.filter(r=>r.id===settlement.id).length,1)
  assert.equal(after.sources.find(r=>r.id===settlement.id).record.amountCents,1000)
  for(const id of [ten.charge.id,changed.charge.id,refundSale.charge.id]){
    const row=after.rows.find(r=>r.id===id);assert.equal(row.unclassifiedCents,row.amountCents);assert.equal(row.earnedCents,0);assert.equal(row.deferredCents,0)
  }
  for(const charge of (await state()).charges.filter(c=>c.freezeId===preview.id||c.planChangeId===change.id)){
    const row=after.rows.find(r=>r.id===charge.id);assert.equal(row.unclassifiedCents,charge.amountCents);assert.ok(after.sources.some(r=>r.id===charge.id))
  }
  assert.equal(after.closing.reconciliationDifferenceCents,0)
  assert.equal((await read('2032-01')).rows.find(r=>r.id===ten.charge.id).earnedCents,2000,'later changes do not poison earlier monthly endpoints')
  const remaining=(await state()).packs.find(p=>p.id===refundSale.pack.id)
  assert.equal(remaining.remaining,10);assert.equal(remaining.expiresAt,cancellation.effectiveAt)
  assert.equal(after.rows.find(r=>r.id===refundSale.charge.id).serviceEnd,refundSale.draft.expiresAt,'unsupported recognition retains the original accepted service period')
  await assertDownloads(h,h.owner,after)
  if(process.env.STRAP_PROOF_DIR)await(await import('./finance-browser.mjs')).financeBrowser(h,{report:after,month:'2032-03',prefix:'adjustments'})
  await jump('2033-01-02T07:00:00Z')
  const expired=await read('2033-01'),annualRow=expired.rows.find(r=>r.id===annual.charge.id)
  assert.equal(annualRow.earnedCents,120001);assert.equal(annualRow.deferredCents,0)
  const unused=expired.rows.find(r=>r.id===expirySale.charge.id)
  assert.deepEqual([unused.earnedCents,unused.deferredCents,unused.unusedPackCents],[0,10003,10003],'expiry never automatically earns unused pack value')
  const version=(await state()).version;await read('2032-03');assert.equal((await state()).version,version)
  console.log('RPT-004 elapsed-time journey: original annual interval, cumulative cents, completed finite service, gift liability and once-only refunds, unclassified changes, retained refund payable and source downloads passed.')
}

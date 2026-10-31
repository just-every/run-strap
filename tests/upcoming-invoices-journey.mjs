import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { upcomingInvoicesBrowser } from './upcoming-invoices-browser.mjs'

// Personal acceptance uses the ordinary commands. Retained records then model elapsed
// agreement and notice clocks, as in the existing recurring-invoice calendar journey.
export async function upcomingInvoicesJourney() {
  await run(async h => {
    await h.confirmSetup(h.owner)
    for(const path of ['/app/upcoming-invoices','/api/strap/reports/upcoming-invoices','/api/strap/reports/upcoming-invoices.csv','/api/strap/reports/upcoming-invoices.xlsx']) {
      const response=await h.send(path,undefined,h.owner)
      assert.equal(response.status,403,response.text)
      assert.equal(path.startsWith('/app/')?response.headers.get('x-strap-refusal'):response.value.error,'mfa_enrollment_required')
    }
  },{mfa:false})
  let providerCalls=0
  await run(async h => {
    await h.confirmSetup(h.owner)
    await h.cmd('studio.save',{location:'Forecast studio',timeZone:'America/New_York'})
    const west=await h.cmd('location.save',{name:'Forecast west',timeZone:'America/Los_Angeles'})
    const base=Date.now(),day=86400000,iso=ms=>new Date(ms).toISOString()
    const save=async(kind,row)=>h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run()
    const agreements=[]
    const sell=async(label,amountCents,extra={})=>{
      const member=await h.person('synthetic-strap-forecast-'+label)
      const approved=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents,expiresAt:iso(base+60*day),...extra})).id})
      const pack=JSON.parse((await h.db.prepare('SELECT data FROM st_records WHERE id=?').bind(approved.id).first()).data)
      const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-'+label})
      const terms=await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie)
      const value={member,pack,terms};agreements.push(value);return value
    }
    const five=[]
    for(let i=0;i<5;i++)five.push(await sell(String(i),10001+i*1001,{planName:i<2?'Mat':'Reformer',locationId:i<3?'studio':west.id}))
    const stopped=await sell('stopped',15000),frozen=await sell('frozen',16000),changed=await sell('changed',17000),overdue=await sell('overdue',18000),stalePrice=await sell('stale-price',19000),erased=await sell('erased',20000),beyond=await sell('beyond-window',21000)
    const oneTime=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:five[0].member.id,credits:5,amountCents:22000,expiresAt:iso(base+60*day)})).id})
    const unaccepted=await h.cmd('plan.recurring.prepare',{packId:oneTime.id,intervalMonths:1,requestId:'synthetic-strap-unaccepted'})
    await h.cmd('plan.recurring.stop',{id:stopped.terms.id,requestId:'synthetic-strap-stop'},stopped.member.cookie)
    stopped.terms=(await h.state()).recurring.terms.find(t=>t.id===stopped.terms.id)
    const type=await h.cmd('freeze.type.save',{name:'Medical',reason:'Agreed time away',feeCents:0,defaultLengthDays:30,maxLengthDays:90,allowedStartDays:[1,2,3,4,5,6,7],allowOpenEnded:true})
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(base+day))
    const freeze=await h.cmd('freeze.prepare',{packId:frozen.pack.id,freezeTypeId:type.id,startAt:date,endAt:null,reason:'Agreed open-ended leave',requestId:'synthetic-strap-freeze'})
    await h.cmd('freeze.accept',{id:freeze.id,key:freeze.key},frozen.member.cookie)
    await h.cmd('freeze.confirm',{id:freeze.id,key:freeze.key,requestId:'synthetic-strap-freeze-confirm'})
    const disclosures=[]
    for(const [a,accepted] of [[five[3],true],[five[4],false],[stalePrice,true]]) {
      const notice=await h.cmd('plan.disclosure.schedule',{termsId:a.terms.id,leadDays:30,proposedAmountCents:17555,requestId:'synthetic-strap-price-'+a.pack.id})
      await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.sendAt',?) WHERE id=?").bind(iso(base-day),notice.id).run()
      await(await h.mf.getWorker()).scheduled()
      if(accepted)await h.cmd('plan.disclosure.accept',{id:notice.id,key:notice.key},a.member.cookie)
      disclosures.push({a,accepted,notice:(await h.state()).renewalDisclosures.find(d=>d.id===notice.id)})
    }
    const instructor=await h.person('synthetic-strap-forecast-instructor','instructor')
    const finance=await h.person('synthetic-strap-forecast-finance');await h.cmd('finance.grant',{id:finance.id});await h.enroll(finance.cookie)
    const agent=await h.cmd('agent.create',{label:'Forecast preparation'})
    const freshOwner=await h.signIn(h.auth.OWNER_EMAIL)
    // Fix this run's window explicitly so crossing local midnight cannot change the selected dates.
    const initial=await h.send('/api/strap/reports/upcoming-invoices',undefined,h.owner)
    assert.equal(initial.status,200,initial.text)
    const query='?from='+initial.value.from,api='/api/strap/reports/upcoming-invoices'+query
    const due=iso(Date.now()+25_000),expectedAmounts=[10001,11002,12003,17555,14005]
    const plainPack=JSON.parse((await h.db.prepare('SELECT data FROM st_records WHERE id=?').bind(oneTime.id).first()).data)
    await save('pack',{...plainPack,expiresAt:due})
    await save('recurringTerms',{...unaccepted,nextRenewalAt:due})
    for(const a of agreements) {
      const when=a===overdue?iso(base-100*day):a===beyond?initial.value.through:a===stopped?iso(Date.parse(initial.value.through)-1):due
      await save('pack',{...a.pack,expiresAt:when,...(a===changed?{amountCents:17001}:{})})
      await save('recurringTerms',{...a.terms,nextRenewalAt:when})
    }
    const currentFreeze=(await h.state()).freezes.freezes.find(f=>f.id===freeze.id)
    await save('freeze',{...currentFreeze,startAt:iso(base-day),status:'active'})
    for(const {a,accepted,notice} of disclosures) {
      const consent=notice.consent.replaceAll(notice.dueAt,due)
      const key=JSON.stringify([notice.id,a.terms.id,a.terms.key,a.pack.id,due,a.terms.amountCents,17555,consent])
      await save('renewalDisclosure',{...notice,dueAt:due,acceptByAt:due,consent,key,
        deliveredAt:iso(Date.parse(due)-31*day),...(accepted?{acceptedAtPrice:iso(base-1000),acceptanceKey:a===stalePrice?'synthetic-strap-stale-key':key,acceptanceText:consent}:{})})
    }
    await h.db.prepare('UPDATE st_people SET erased_at=1,active=0 WHERE id=?').bind(erased.member.id).run()
    const retained=async()=>({records:(await h.db.prepare('SELECT * FROM st_records ORDER BY id').all()).results,
      meta:(await h.db.prepare('SELECT * FROM st_meta').all()).results,connection:(await h.db.prepare('SELECT * FROM st_contract_connections').all()).results,
      notices:(await h.db.prepare('SELECT * FROM st_notice_deliveries ORDER BY id').all()).results})
    const before=await retained(),calls=providerCalls
    const report=await h.send(api,undefined,h.owner)
    assert.equal(report.status,200,report.text)
    const forecast=report.value,scheduled=forecast.rows.filter(r=>r.status==='scheduled')
    assert.deepEqual(scheduled.map(r=>r.agreementId).sort(),five.map(a=>a.terms.id).sort())
    for(const [i,a] of five.entries()) {
      const row=scheduled.find(r=>r.agreementId===a.terms.id)
      assert.deepEqual([row.packId,row.originalPackId,row.personId,row.dueAt,row.amountCents,row.forecastCents,row.paymentReadiness],
        [a.pack.id,a.pack.id,a.member.id,due,expectedAmounts[i],expectedAmounts[i],'unavailable'])
      assert.equal(row.agreedAmountCents,a.terms.amountCents)
    }
    const total=64566
    assert.deepEqual(forecast.totals,{scheduledCount:5,forecastCents:total,excludedCount:4,overdueCount:1})
    assert.equal(forecast.daily.reduce((sum,d)=>sum+d.forecastCents,0),total)
    assert.equal(forecast.rows.some(r=>r.agreementId===beyond.terms.id),false,'the next local midnight after seven dates is excluded')
    assert.equal(forecast.rows.find(r=>r.agreementId===stopped.terms.id).localDate,forecast.daily.at(-1).date,'the final selected local date is included')
    const controls=[[stopped,'canceled','agreement_stopped'],[frozen,'blocked','freeze_covers_invoice_date'],[changed,'review','source_terms_changed'],[stalePrice,'review','accepted_price_source_changed']]
    for(const [a,status,reason] of controls){const row=forecast.rows.find(r=>r.agreementId===a.terms.id);assert.deepEqual([row.status,row.reason,row.forecastCents],[status,reason,0])}
    assert.deepEqual(forecast.overdue.map(r=>[r.agreementId,r.status,r.reason,r.forecastCents]),[[overdue.terms.id,'review','billing_period_already_ended',0]])
    assert.equal(JSON.stringify(forecast).includes(erased.member.name),false,'erased member details stay absent')
    assert.equal(forecast.rows.some(r=>r.packId===oneTime.id),false,'neither a one-time pack nor its unaccepted proposal is a recurring forecast')
    const csv=await h.send('/api/strap/reports/upcoming-invoices.csv'+query,undefined,h.owner)
    assert.equal(csv.status,200,csv.text)
    const {parseCsv}=await import('./report-downloads.mjs')
    const records=parseCsv(csv.text)
    const index=name=>records[0].indexOf(name)
    const values=records.slice(1)
    assert.equal(values.filter(row=>row[0]==='invoice').reduce((sum,row)=>sum+row[index('forecastCents')],0),total)
    assert.equal(values.find(row=>row[0]==='period-total')[index('forecastCents')],total)
    for(const r of scheduled){const row=values.find(row=>row[index('agreementId')]===r.agreementId);assert.equal(row[index('dueAt')],due);assert.equal(row[index('invoiceAmountCents')],r.amountCents)}
    const {readDownload}=await import('./report-downloads.mjs')
    const filtered=async(params,expectedIds,expectedTotal)=>{
      const suffix='?'+new URLSearchParams({from:forecast.from,...params}),path='/api/strap/reports/upcoming-invoices'
      const response=await h.send(path+suffix,undefined,h.owner)
      assert.equal(response.status,200,response.text)
      const result=response.value
      assert.deepEqual(result.rows.map(r=>r.agreementId).sort(),expectedIds.slice().sort())
      assert.equal(result.totals.forecastCents,expectedTotal)
      assert.equal(result.daily.reduce((sum,d)=>sum+d.forecastCents,0),expectedTotal)
      const download=await h.send(path+'.csv'+suffix,undefined,h.owner)
      assert.equal(download.status,200,download.text)
      const csvRows=parseCsv(download.text),sheets=await readDownload(h,path+'.xlsx'+suffix)
      assert.deepEqual(sheets.find(s=>s.sheet==='Forecast').data,csvRows,'filtered spreadsheet retains every typed source, date, reason, cent and summary in CSV')
      const [columns,...data]=csvRows,at=key=>columns.indexOf(key)
      assert.deepEqual(data.filter(r=>r[0]==='invoice').map(r=>r[at('agreementId')]).sort(),expectedIds.slice().sort())
      assert.equal(data.find(r=>r[0]==='period-total')[at('forecastCents')],expectedTotal)
      assert.equal(data.filter(r=>r[0]==='invoice').reduce((sum,r)=>sum+r[at('forecastCents')],0),expectedTotal)
      assert.deepEqual(Object.fromEntries(sheets.find(s=>s.sheet==='Totals').data.slice(1)),result.totals)
      const context=Object.fromEntries(sheets.find(s=>s.sheet==='Context').data.slice(1))
      assert.deepEqual(JSON.parse(context.filters),result.filters)
      assert.equal(context.timeZone,'America/New_York')
      return result
    }
    await filtered({},forecast.rows.map(r=>r.agreementId),total)
    await filtered({location:west.id},[five[3].terms.id,five[4].terms.id],31560)
    await filtered({plan:'credits: Mat'},[five[0].terms.id,five[1].terms.id],21003)
    await filtered({status:'blocked'},[frozen.terms.id],0)
    const reviews=await filtered({status:'review'},[changed.terms.id,stalePrice.terms.id],0)
    assert.deepEqual(reviews.overdue.map(r=>r.agreementId),[overdue.terms.id],'status also filters the overdue review list')
    const focused={from:scheduled[0].localDate,to:scheduled[0].localDate,location:west.id,plan:'credits: Reformer',status:'scheduled'}
    await filtered(focused,[five[3].terms.id,five[4].terms.id],31560)
    await filtered({from:forecast.daily.at(-1).date,to:forecast.daily.at(-1).date},[stopped.terms.id],0)
    await filtered({from:forecast.throughDate,to:forecast.throughDate,status:'scheduled'},[beyond.terms.id],21000)
    await filtered({location:'synthetic-strap-unknown'},[],0)
    await filtered({plan:'synthetic-strap-unknown'},[],0)
    for(const cookie of [five[0].member.cookie,instructor.cookie,finance.cookie,freshOwner,''])for(const path of ['/app/upcoming-invoices'+query,api,'/api/strap/reports/upcoming-invoices.csv'+query,'/api/strap/reports/upcoming-invoices.xlsx'+query]) {
      const r=await h.send(path,undefined,cookie);assert.equal(r.status,cookie?403:path.startsWith('/app/')?303:401,path+': '+r.text);if(r.status===303)assert.match(r.headers.get('location'),/^\/signin\?returnTo=/);assert.equal(r.text.includes(five[0].pack.id),false)
    }
    assert.equal((await h.send(api,undefined,'',{authorization:'Bearer '+agent.token})).status,401)
    assert.equal((await h.send('/api/strap/agent/reports/upcoming-invoices'+query,undefined,'',{authorization:'Bearer '+agent.token})).status,404)
    assert.equal((await h.send('/app/upcoming-invoices'+query,{},h.owner)).status,404)
    assert.equal((await h.send('/api/strap/reports/upcoming-invoices?from=invalid',undefined,h.owner)).status,400)
    for(const params of [{from:'2026-02-30'},{to:'2026-02-30'},{from:'2026-11-02',to:'2026-11-01'},{from:'2026-01-01',to:'2027-01-02'},{status:'synthetic-strap-unknown'}])for(const extension of ['', '.csv','.xlsx']) {
      assert.equal((await h.send('/api/strap/reports/upcoming-invoices'+extension+'?'+new URLSearchParams(params),undefined,h.owner)).status,400)
    }
    await upcomingInvoicesBrowser(h,{query,scheduled,total,focused,focusedRows:scheduled.filter(r=>r.locationId===west.id),focusedTotal:31560})
    assert.deepEqual(await retained(),before,'populated screen, JSON, CSV and refused reads change no studio records or execution authority')
    assert.equal(providerCalls,calls,'forecast reads never call a provider')
    console.log('PROBE BILL-013 forecast: five personally accepted agreements -> five eligible invoices, 64566 cents; blocked freeze, stopped agreement, changed source, stale accepted price and expired period excluded; CSV and daily sums match; erased member withheld.')
    console.log('PROBE BILL-013 filters and exports: combined date, west sale location, accepted Reformer plan and scheduled status -> exactly two source-linked invoices, 31560 cents on screen, JSON, CSV and XLSX; review, excluded, empty and inclusive date-boundary selections agree; unaccepted and one-time sources absent.')
    console.log('PROBE BILL-013 read authority: owner with MFA -> populated screen, JSON and CSV; new owner session, member, instructor, finance and bearer -> refused; all reads leave studio records unchanged and make zero provider calls.')
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(due)-Date.now()+100)))
    for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled()
    const after=await h.state(),invoices=after.recurring.invoices.filter(i=>five.some(a=>a.terms.id===i.recurringTermsId))
    assert.equal(invoices.length,5)
    for(const row of scheduled) {
      const invoice=invoices.find(i=>i.recurringTermsId===row.agreementId)
      assert.deepEqual([invoice.previousPackId,invoice.dueAt,invoice.amountCents,invoice.termEndAt],[row.packId,row.dueAt,row.amountCents,row.termEndAt])
      assert.equal(after.charges.filter(c=>c.invoiceId===invoice.id).length,1)
      const renewed=after.packs.find(p=>p.id===invoice.packId),original=five.find(a=>a.terms.id===row.agreementId).pack
      assert.deepEqual([renewed.locationId,renewed.eligibleLocations],[original.locationId,original.eligibleLocations],'renewal retains its original sale location and permitted booking locations')
    }
    for(const a of [stopped,frozen,changed,overdue,stalePrice,erased,beyond])assert.equal(after.recurring.invoices.filter(i=>i.recurringTermsId===a.terms.id).length,0)
    assert.equal(invoices.reduce((sum,i)=>sum+i.amountCents,0),total)
    assert.equal((await h.send(api,undefined,h.owner)).value.totals.forecastCents,0,'issued periods leave the forecast once')
    assert.equal(providerCalls,calls,'native invoice issuance grants no provider collection authority')
    const nextDue=after.recurring.terms.find(t=>t.id===five[3].terms.id).nextRenewalAt
    const nextDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(nextDue))
    const nextForecast=await filtered({from:nextDate,location:west.id,status:'scheduled'},[five[3].terms.id,five[4].terms.id],31560)
    for(const row of nextForecast.rows) {
      const original=five.find(a=>a.terms.id===row.agreementId),invoice=invoices.find(i=>i.recurringTermsId===row.agreementId)
      assert.equal(row.originalPackId,original.pack.id);assert.equal(row.packId,invoice.packId)
    }
    const start=iso(Date.now()+day),d=new Date(start),week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
    const classes=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[
      {title:'synthetic-strap-west-renewal',locationId:west.id,start,end:iso(Date.parse(start)+3600000),capacity:2,instructorId:instructor.id},
      {title:'synthetic-strap-other-renewal',locationId:'studio',start:iso(Date.parse(start)+7200000),end:iso(Date.parse(start)+10800000),capacity:2,instructorId:instructor.id},
    ]})).id})).classes
    const outsideVersion=(await h.state()).version
    await h.cmd('booking.book',{classId:classes[1].id},five[3].member.cookie,409)
    assert.equal((await h.state()).version,outsideVersion,'renewal cannot grant access to an unaccepted location')
    const booked=await h.cmd('booking.book',{classId:classes[0].id},five[3].member.cookie)
    assert.equal(booked.packId,invoices.find(i=>i.recurringTermsId===five[3].terms.id).packId,'renewed credits fund the accepted location')
    // Native renewals made by the earlier implementation retained their original pack
    // but omitted location fields on the successor. Reading them must not invent a new sale location.
    const {locationId,eligibleLocations,...legacy}=after.packs.find(p=>p.id===invoices.find(i=>i.recurringTermsId===five[3].terms.id).packId)
    await save('pack',legacy)
    const legacyBefore=await retained(),legacyCalls=providerCalls
    await filtered({from:nextDate,location:west.id,status:'scheduled'},[five[3].terms.id,five[4].terms.id],31560)
    assert.deepEqual(await retained(),legacyBefore,'legacy location recovery is a pure projection of retained original terms')
    assert.equal(providerCalls,legacyCalls)
    console.log('PROBE BILL-013 issuance: elapsed due instant and duplicate scheduler invocation -> exactly five invoices and five charges, dates and cents equal the forecast, excluded controls create no invoice and no provider collection occurs.')
    console.log('PROBE BILL-013 location continuity: duplicate native issuance -> renewed packs retain original sale and booking locations; next west forecast and both downloads still select exactly two invoices totaling 31560 cents with original and successor identities.')
  },{outbound:()=>{providerCalls++;throw Error('Unexpected provider request')}})
}

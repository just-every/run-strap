import { insist, list, type State, type RecordData } from './domain/types'
import { studioSettings } from './domain/studio'
import { countsCredits } from './domain/entitlements'
import { halfUp } from './domain/plan-changes'
import { localDate, localInstant } from './zone'
import { csv, workbook, type Cell } from './spreadsheet'

export const financeDefinitions = [
  'Provisional owner-only management report, pending accounting-policy review. USD cents; calendar months on the studio clock. Cash means recorded external receipts less recorded external refunds, not verified processor settlement. Invoiced dues are signed service charges, not cash collected. Gift funding is excluded from service invoices and revenue.',
  'Time-based plans recognize the original accepted price over the original accepted service interval, in elapsed milliseconds with cumulative half-up rounding. Finite packs recognize the original price per original credit only after an attended class has ended. Reservations, no-shows, forfeiture, expiry and manual credit reductions do not earn revenue. Attendance corrections restate prior periods; this is not a closed accounting journal.',
  'Deferred revenue includes unpaid invoiced service value; unused-pack liability is its finite-pack subset, never an additional liability. Receipt allocations are not invented. Gift liability follows signed gift entries; redemption is noncash settlement of a separate retail sale. Gift funding refunds reduce cash and gift liability once; returned gift tender restores liability without a cash refund.',
  'Retail sales and returns recognize their signed charge on recording. Other fees, changed or frozen plans, cancellation credits and unsupported records remain unclassified for owner review. Original pack terms remain the recognition basis despite access or expiry adjustments. No automatic breakage recognition, tax calculation, tax exclusion or filing claim. Tax is unavailable until BILL-012 supplies classified invoice and reversal records.',
  'Opening and closing amounts are retained-record projections. Period earned revenue is closing earned less opening earned. Net cash plus the signed receivable balance must equal earned plus deferred plus gift liability plus unclassified value. A nonzero reconciliation difference remains visible, including unsupported gift adjustments. No accounting posting, collection, refund or outbound action occurs on report reads.'
]
const sum = (rows: RecordData[], field='amountCents') => rows.reduce((n,r)=>n+(r[field] ?? 0),0)
const rounded = (amount: number, numerator: number, denominator: number) => halfUp(BigInt(amount)*BigInt(numerator),BigInt(denominator))

export function financeReport(state: State, query: URLSearchParams) {
  const generatedAt = new Date().toISOString(), timeZone = studioSettings(state)?.timeZone ?? 'UTC'
  const month = query.get('financeMonth') || localDate(generatedAt,timeZone).slice(0,7)
  insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0,4)) >= 1970 && Number(month.slice(0,4)) <= 9998,'invalid_finance_month')
  const [year,m] = month.split('-').map(Number), next = m === 12 ? `${year+1}-01` : `${year}-${String(m+1).padStart(2,'0')}`
  const start = Date.parse(localInstant(month+'-01','00:00',timeZone)), end = Date.parse(localInstant(next+'-01','00:00',timeZone))
  const cutoff = Math.min(end,Date.parse(generatedAt)+1), openingAt = Math.min(start,cutoff)
  const charges = list(state,'charge'), payments = list(state,'payment'), entries = list(state,'giftEntry')
  const packs = list(state,'pack'), classes = list(state,'class'), bookings = list(state,'booking')
  const before = (row: RecordData, at: number) => Date.parse(row.createdAt) < at
  const sourceUrl = (id: string) => `/app/revenue?financeMonth=${month}&financeSource=${encodeURIComponent(id)}#finance-source`
  const snapshot = (at: number) => {
    const rows = charges.filter(c=>before(c,at)).map(charge => {
      const pack = packs.find(p=>p.id===charge.packId), draft = pack ? state.records.get(pack.draftId)?.data : null
      let earnedCents=0, deferredCents=0, unclassifiedCents=0, basis='Owner review required', serviceStart: string|null=null, serviceEnd: string|null=null, consumedBookingIds: string[]=[]
      const amount = charge.amountCents
      if (charge.reason === 'gift_card_issue') basis='Gift funding, excluded from service revenue'
      else if (['retail_sale','retail_return'].includes(charge.reason)) { earnedCents=amount; basis='Recorded retail fulfillment or return' }
      else if (pack && draft?.type==='pack' && !charge.reason && amount >= 0 && !list(state,'freeze').some(f=>f.packId===pack.id) && !list(state,'contractCancellation').some(c=>c.packId===pack.id) && !list(state,'planChange').some(c=>c.packId===pack.id && c.status==='applied')) {
        serviceStart=pack.proration?.joinAt ?? pack.createdAt; serviceEnd=draft.expiresAt
        if (countsCredits(pack)) {
          consumedBookingIds=bookings.filter(b=>b.packId===pack.id && b.attendance==='attended' && Date.parse(b.checkedInAt ?? '') < at && classes.some(c=>c.id===b.classId && Date.parse(c.end)<at)).map(b=>b.id)
          const credits=draft.credits
          if (Number.isSafeInteger(credits) && credits>0) { earnedCents=rounded(amount,Math.min(credits,consumedBookingIds.length),credits); deferredCents=amount-earnedCents; basis='Completed attended services over original credits' }
          else unclassifiedCents=amount
        } else {
          const from=Date.parse(serviceStart!), through=Date.parse(serviceEnd!)
          if (Number.isFinite(from) && Number.isFinite(through) && through>from) { earnedCents=rounded(amount,Math.max(0,Math.min(at,through)-from),through-from); deferredCents=amount-earnedCents; basis='Original accepted time-based service interval' }
          else unclassifiedCents=amount
        }
      } else unclassifiedCents=amount
      return {id:charge.id,personId:charge.personId,packId:pack?.id ?? null,amountCents:amount,earnedCents,deferredCents,unusedPackCents:pack && countsCredits(pack) ? deferredCents : 0,unclassifiedCents,basis,serviceStart,serviceEnd,consumedBookingIds,sourceUrl:sourceUrl(charge.id)}
    })
    const cash=payments.filter(p=>before(p,at) && p.reason!=='gift_card_redemption'), noncash=payments.filter(p=>before(p,at) && p.reason==='gift_card_redemption')
    const invoiceRows=charges.filter(c=>before(c,at)), giftRows=entries.filter(e=>before(e,at))
    const totals={cashCents:sum(cash),serviceInvoiceCents:sum(invoiceRows.filter(c=>c.reason!=='gift_card_issue')),giftFundingCents:sum(invoiceRows.filter(c=>c.reason==='gift_card_issue')),noncashGiftTenderCents:sum(noncash),receivableCents:sum(invoiceRows)-sum(cash)-sum(noncash),earnedCents:sum(rows,'earnedCents'),deferredCents:sum(rows,'deferredCents'),unusedPackCents:sum(rows,'unusedPackCents'),giftLiabilityCents:sum(giftRows),unclassifiedCents:sum(rows,'unclassifiedCents'),reconciliationDifferenceCents:0}
    totals.reconciliationDifferenceCents=totals.cashCents+totals.receivableCents-totals.earnedCents-totals.deferredCents-totals.giftLiabilityCents-totals.unclassifiedCents
    return {rows,totals}
  }
  const opening=snapshot(openingAt), closing=snapshot(cutoff)
  const period=Object.fromEntries(Object.entries(closing.totals).map(([key,value])=>[key,value-opening.totals[key as keyof typeof opening.totals]]))
  const sources=[...charges.map(record=>({kind:'invoice',record})),...payments.map(record=>({kind:record.reason==='gift_card_redemption'?'gift-tender':'cash',record})),...entries.map(record=>({kind:'gift-liability',record}))].filter(({record})=>before(record,cutoff)).map(({kind,record})=>({id:record.id,kind,at:record.createdAt,amountCents:record.amountCents,inPeriod:Date.parse(record.createdAt)>=start,sourceUrl:sourceUrl(record.id),record})).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))
  return {month,timeZone,generatedAt,through:new Date(cutoff).toISOString(),opening:opening.totals,closing:closing.totals,period,rows:closing.rows,sources,selectedSource:sources.find(r=>r.id===query.get('financeSource'))??null,taxCents:null,definitions:financeDefinitions}
}

export function financeDownload(report: ReturnType<typeof financeReport>, format: string) {
  const metrics: Cell[][]=[['Metric','Opening cents','Period cents','Closing cents'],...Object.entries(report.closing).map(([key,value])=>[key,report.opening[key as keyof typeof report.opening],report.period[key],value])]
  const sources: Cell[][]=[['id','kind','at','amountCents','inPeriod','sourceUrl'],...report.sources.map(s=>[s.id,s.kind,s.at,s.amountCents,s.inPeriod,s.sourceUrl])]
  const recognition: Cell[][]=[['chargeId','packId','earnedCents','deferredCents','unusedPackCents','unclassifiedCents','serviceStart','serviceEnd','consumedBookingIds'],...report.rows.map(r=>[r.id,r.packId,r.earnedCents,r.deferredCents,r.unusedPackCents,r.unclassifiedCents,r.serviceStart,r.serviceEnd,JSON.stringify(r.consumedBookingIds)])]
  const context: Cell[][]=[['Month',report.month],['Time zone',report.timeZone],['Through',report.through],['Tax','Unavailable'],...report.definitions.map(d=>['Definition',d])]
  const csvRows: Cell[][]=[['kind','id','at','amountCents','inPeriod','sourceUrl','openingCents','periodCents','closingCents','earnedCents','deferredCents','unusedPackCents','unclassifiedCents','serviceStart','serviceEnd','consumedBookingIds'],...report.sources.map(r=>[r.kind,r.id,r.at,r.amountCents,r.inPeriod,r.sourceUrl]),...Object.entries(report.closing).map(([key,value])=>['metric',key,null,null,null,null,report.opening[key as keyof typeof report.opening],report.period[key],value]),...report.rows.map(r=>['recognition',r.id,null,r.amountCents,null,r.sourceUrl,null,null,null,r.earnedCents,r.deferredCents,r.unusedPackCents,r.unclassifiedCents,r.serviceStart,r.serviceEnd,JSON.stringify(r.consumedBookingIds)])]
  return new Response((format==='csv' ? csv(csvRows) : workbook([{name:'Ledger',rows:sources},{name:'Reconciliation',rows:metrics},{name:'Recognition',rows:recognition},{name:'Policy',rows:context}])) as BodyInit,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff','content-type':format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="strap-finance.${format}"`}})
}

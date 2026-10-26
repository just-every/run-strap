import { insist, list, type State, type RecordData } from './domain/types'
import { studioSettings } from './domain/studio'
import { countsCredits } from './domain/entitlements'
import { halfUp } from './domain/plan-changes'
import { localDate, localInstant } from './zone'
import { csv, workbook, type Cell } from './spreadsheet'
import { financeRefunds } from './finance-refunds'
import { finiteRefundClassification } from './finance-finite-refunds'
import { timeRefundClassification } from './finance-time-refunds'
import { financeTax } from './finance-tax'

export const financeDefinitions = [
  'Provisional management report through the MFA-protected owner reporting door; operational recognition default approved with riders on 26 October 2026. SEC-004 separately governs its explicit finance-report grant. USD cents; calendar months on the studio clock. Cash means recorded external receipts less recorded external refunds, not verified processor settlement. Invoiced dues are signed service charges, not cash collected. Gift funding is excluded from service invoices and revenue.',
  'Time-based plans recognize the original accepted price over the original accepted service interval, in elapsed milliseconds with cumulative half-up rounding. Finite packs recognize the original price per original credit only after an attended class has ended. Reservations, no-shows, forfeiture, expiry and manual credit reductions do not earn revenue. Attendance corrections restate prior periods; this is not a closed accounting journal.',
  'Deferred revenue includes unpaid invoiced service value; unused-pack liability is its finite-pack subset, never an additional liability. Receipt allocations are not invented. Gift liability follows signed gift entries; redemption is noncash settlement of a separate retail sale. Gift funding refunds reduce cash and gift liability once; returned gift tender restores liability without a cash refund.',
  'Retail sales and returns recognize their signed charge on recording. A finite pack with access-only freezes retains its original accepted price and original quantity; the freeze and its extension earn nothing. Other fees, changed plans, frozen time-based plans, cancellation credits and unsupported records remain unclassified for owner review. Original pack terms remain the recognition basis despite access or expiry adjustments. No automatic breakage recognition, tax calculation, tax exclusion or filing claim. Tax remains unavailable for every charge without retained BILL-012 classification and reversal evidence. Known provider-classified tax is shown separately, with its provider mode; a known zero is never substituted for an unclassified amount. Test provider evidence is not production tax readiness or filing evidence.',
  'Opening and closing amounts are retained-record projections. Period earned revenue is closing earned less opening earned. Net cash plus the signed receivable balance must equal earned plus deferred plus gift liability plus unclassified value plus refund payable plus separately classified tax liability. Approved cancellation refunds remain distinct from invoice credits: known refund dues reduce unclassified value and establish a payable; recorded external settlements reduce cash and that payable once, using their recording instant. Known ordinary finite-pack and unchanged unlimited time-based refunds reduce original unearned value when the approved refund does not exceed it and the pack has no changed consideration or mixed fee charges; completed service remains earned and original entitlements remain the calculation basis. For a time-based cancellation, recognition stops at the confirmed service end while its original accepted interval remains visible. An unpaid invoice portion does not become earned or disappear on cancellation. The approved refund establishes a separate payable; settlement never earns value or changes service credits. Cooling-off allocations, mixed fees, changed consideration, refunds exceeding unearned value and unknown refund dues remain explicitly unclassified or unavailable, never assumed zero. A nonzero reconciliation difference remains visible, including unsupported gift adjustments. No accounting posting, collection, refund or outbound action occurs on report reads.'
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
  const refunds = financeRefunds(state)
  const packs = list(state,'pack'), classes = list(state,'class'), bookings = list(state,'booking')
  const before = (row: RecordData, at: number) => Date.parse(row.createdAt) < at
  const sourceUrl = (id: string) => `/app/revenue?financeMonth=${month}&financeSource=${encodeURIComponent(id)}#finance-source`
  const snapshot = (at: number) => {
    const supportedRefunds=new Map<string,{refundIds:Set<string>;chargeId:string;serviceThrough?:number}>([...finiteRefundClassification(state,at),...timeRefundClassification(state,at)])
    const refund = refunds.snapshot(at), invoiceRows=charges.filter(c=>before(c,at)), tax=financeTax(state,at,invoiceRows)
    const rows = invoiceRows.map(charge => {
      const pack = packs.find(p=>p.id===charge.packId), draft = pack ? state.records.get(pack.draftId)?.data : null
      let earnedCents=0, deferredCents=0, unclassifiedCents=0, basis='Owner review required', serviceStart: string|null=null, serviceEnd: string|null=null, serviceStoppedAt: string|null=null, consumedBookingIds: string[]=[]
      const amount = charge.amountCents
      if (pack && draft?.type==='pack') { serviceStart=pack.proration?.joinAt ?? pack.createdAt; serviceEnd=draft.expiresAt }
      if (tax.classified.has(charge.id)) basis='Retained provider-classified tax liability; separate from service revenue'
      else if (charge.reason === 'gift_card_issue') basis='Gift funding, excluded from service revenue'
      else if (['retail_sale','retail_return'].includes(charge.reason)) { earnedCents=amount; basis='Recorded retail fulfillment or return' }
      else if (pack && draft?.type==='pack' && !charge.reason && !charge.kind && amount >= 0 && (countsCredits(pack) || !list(state,'freeze').some(f=>f.packId===pack.id && f.confirmedAt && Date.parse(f.confirmedAt)<at && !['withdrawn','declined'].includes(f.status))) && (supportedRefunds.has(pack.id) || !list(state,'contractCancellation').some(c=>c.packId===pack.id && ['scheduled','applied'].includes(c.status) && Date.parse(c.confirmedAt)<at)) && !list(state,'planChange').some(c=>c.packId===pack.id && c.status==='applied' && Date.parse(c.appliedAt)<at)) {
        serviceStart=pack.proration?.joinAt ?? pack.createdAt; serviceEnd=draft.expiresAt
        if (countsCredits(pack)) {
          consumedBookingIds=bookings.filter(b=>b.packId===pack.id && b.attendance==='attended' && Date.parse(b.checkedInAt ?? '') < at && classes.some(c=>c.id===b.classId && Date.parse(c.end)<at)).map(b=>b.id)
          const credits=draft.credits
          if (Number.isSafeInteger(credits) && credits>0) { earnedCents=rounded(amount,Math.min(credits,consumedBookingIds.length),credits); deferredCents=amount-earnedCents; basis='Completed attended services over original credits' }
          else unclassifiedCents=amount
        } else {
          const from=Date.parse(serviceStart!), through=Date.parse(serviceEnd!)
          if (Number.isFinite(from) && Number.isFinite(through) && through>from) { const stop=supportedRefunds.get(pack.id)?.serviceThrough; serviceStoppedAt=stop===undefined?null:new Date(stop).toISOString(); earnedCents=rounded(amount,Math.max(0,Math.min(at,through,stop ?? through)-from),through-from); deferredCents=amount-earnedCents; basis=stop===undefined?'Original accepted time-based service interval':'Original accepted time-based interval, recognition stopped at confirmed service termination' }
          else unclassifiedCents=amount
        }
      } else unclassifiedCents=amount
      return {id:charge.id,personId:charge.personId,packId:pack?.id ?? null,amountCents:amount,earnedCents,deferredCents,unusedPackCents:pack && countsCredits(pack) ? deferredCents : 0,unclassifiedCents,basis,serviceStart,serviceEnd,serviceStoppedAt,consumedBookingIds,sourceUrl:sourceUrl(charge.id)}
    })
    rows.push(...refund.rows.map(row=>{
      const supported=supportedRefunds.get(row.packId),original=supported ? rows.find(r=>r.id===supported.chargeId) : null
      return {...row,...(supported?.refundIds.has(row.id)&&original?.deferredCents ? {deferredCents:row.amountCents,unusedPackCents:supported.serviceThrough===undefined?row.amountCents:0,unclassifiedCents:0,basis:'Approved refund of unearned original service value; delivered service remains earned',serviceStart:original.serviceStart,serviceEnd:original.serviceEnd,serviceStoppedAt:original.serviceStoppedAt} : {}),sourceUrl:sourceUrl(row.id)}
    }))
    const cash=payments.filter(p=>before(p,at) && p.reason!=='gift_card_redemption'), noncash=payments.filter(p=>before(p,at) && p.reason==='gift_card_redemption')
    const giftRows=entries.filter(e=>before(e,at))
    const totals={cashCents:sum(cash)-refund.settledCents,serviceInvoiceCents:sum(invoiceRows.filter(c=>c.reason!=='gift_card_issue' && !tax.classified.has(c.id))),giftFundingCents:sum(invoiceRows.filter(c=>c.reason==='gift_card_issue')),noncashGiftTenderCents:sum(noncash),receivableCents:sum(invoiceRows)-sum(cash)-sum(noncash),earnedCents:sum(rows,'earnedCents'),deferredCents:sum(rows,'deferredCents'),unusedPackCents:sum(rows,'unusedPackCents'),giftLiabilityCents:sum(giftRows),unclassifiedCents:sum(rows,'unclassifiedCents'),taxLiabilityCents:tax.knownTaxCents,refundDueCents:refund.dueCents,refundSettledCents:refund.settledCents,refundPayableCents:refund.payableCents,reconciliationDifferenceCents:0}
    totals.reconciliationDifferenceCents=totals.cashCents+totals.receivableCents-totals.earnedCents-totals.deferredCents-totals.giftLiabilityCents-totals.unclassifiedCents-totals.refundPayableCents-totals.taxLiabilityCents
    return {rows,totals,unavailableRefundIds:refund.unavailableIds,tax}
  }
  const opening=snapshot(openingAt), closing=snapshot(cutoff)
  const period=Object.fromEntries(Object.entries(closing.totals).map(([key,value])=>[key,value-opening.totals[key as keyof typeof opening.totals]]))
  const ledgerSources = [...charges.map(record=>({kind:'invoice',record,at:record.createdAt,amountCents:record.amountCents})),...payments.map(record=>({kind:record.reason==='gift_card_redemption'?'gift-tender':'cash',record,at:record.createdAt,amountCents:record.amountCents})),...entries.map(record=>({kind:'gift-liability',record,at:record.createdAt,amountCents:record.amountCents})),...refunds.sources]
  const sources=ledgerSources.filter(row=>Date.parse(row.at)<cutoff).map(({kind,record,at,amountCents})=>({id:record.id,kind,at,amountCents,inPeriod:Date.parse(at)>=start,sourceUrl:sourceUrl(record.id),record})).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))
  return {month,timeZone,generatedAt,through:new Date(cutoff).toISOString(),opening:opening.totals,closing:closing.totals,period,rows:closing.rows,sources,selectedSource:sources.find(r=>r.id===query.get('financeSource'))??null,taxCents:closing.tax.taxCents,knownTaxCents:closing.tax.knownTaxCents,unavailableTaxChargeIds:closing.tax.unavailableChargeIds,taxModes:closing.tax.modes,unavailableRefundIds:closing.unavailableRefundIds,definitions:financeDefinitions}
}

export function financeDownload(report: ReturnType<typeof financeReport>, format: string) {
  const metrics: Cell[][]=[['Metric','Opening cents','Period cents','Closing cents'],...Object.entries(report.closing).map(([key,value])=>[key,report.opening[key as keyof typeof report.opening],report.period[key],value])]
  const sources: Cell[][]=[['id','kind','at','amountCents','inPeriod','sourceUrl'],...report.sources.map(s=>[s.id,s.kind,s.at,s.amountCents,s.inPeriod,s.sourceUrl])]
  const recognition: Cell[][]=[['chargeId','packId','earnedCents','deferredCents','unusedPackCents','unclassifiedCents','serviceStart','serviceEnd','consumedBookingIds','serviceStoppedAt','personId','amountCents','basis','sourceUrl'],...report.rows.map(r=>[r.id,r.packId,r.earnedCents,r.deferredCents,r.unusedPackCents,r.unclassifiedCents,r.serviceStart,r.serviceEnd,JSON.stringify(r.consumedBookingIds),r.serviceStoppedAt,r.personId,r.amountCents,r.basis,r.sourceUrl])]
  const context: Cell[][]=[['Month',report.month],['Time zone',report.timeZone],['Through',report.through],['Tax',report.taxCents===null ? 'Unavailable' : report.taxCents],['Known classified tax cents',report.knownTaxCents],['Tax provider modes',report.taxModes.join(', ')],...report.unavailableTaxChargeIds.map(id=>['Tax classification unavailable',id]),...report.unavailableRefundIds.map(id=>['Refund valuation unavailable',id]),...report.definitions.map(d=>['Definition',d])]
  const csvRows: Cell[][]=[['kind','id','at','amountCents','inPeriod','sourceUrl','openingCents','periodCents','closingCents','earnedCents','deferredCents','unusedPackCents','unclassifiedCents','serviceStart','serviceEnd','consumedBookingIds','serviceStoppedAt','definition','packId','personId','basis'],...report.sources.map(r=>[r.kind,r.id,r.at,r.amountCents,r.inPeriod,r.sourceUrl]),...Object.entries(report.closing).map(([key,value])=>['metric',key,null,null,null,null,report.opening[key as keyof typeof report.opening],report.period[key],value]),...report.rows.map(r=>['recognition',r.id,null,r.amountCents,null,r.sourceUrl,null,null,null,r.earnedCents,r.deferredCents,r.unusedPackCents,r.unclassifiedCents,r.serviceStart,r.serviceEnd,JSON.stringify(r.consumedBookingIds),r.serviceStoppedAt,null,r.packId,r.personId,r.basis]),...context.map(([key,value])=>['policy',key,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,value])]
  return new Response((format==='csv' ? csv(csvRows) : workbook([{name:'Ledger',rows:sources},{name:'Reconciliation',rows:metrics},{name:'Recognition',rows:recognition},{name:'Policy',rows:context}])) as BodyInit,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff','content-type':format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="strap-finance.${format}"`}})
}

import type { leadReport } from '../lead-report'
import { money } from './format'
import { body, field, form, h, hidden, panel, select, textarea } from './shared'

const path = '/app/leads'
const request = () => hidden('requestId',crypto.randomUUID())
export function leadCampaignPanel(report: ReturnType<typeof leadReport>, offers: any[]) {
  const campaigns = report.campaigns.map(c => `<article id="${h(c.id)}" data-funnel-campaign="${h(c.id)}"><h3>${h(c.name)}</h3>`
    +`<p>${c.members} leads · ${c.introPurchases} intro purchases · ${c.firstVisits} first visits · ${c.nativeMembershipConversions} native conversions · ${c.repeatAttendance} repeat attendance · ${c.lostInquiries} lost</p>`
    +`<p>Recorded cost <strong data-campaign-cost>${money(c.costCents)}</strong> · Gross invoiced revenue <strong data-campaign-revenue>${money(c.attributedRevenueCents)}</strong></p>`
    +`<p><a href="${path}?funnelCampaign=${encodeURIComponent(c.id)}">Drill into campaign members and sales</a></p>`
    +`<details><summary>Campaign and spending evidence</summary><p>Intro offer: ${h(offers.find(o => o.id === c.introOfferId)?.name)}. Purchase window: ${h(c.startsAt)} to ${h(c.endsAt)} (exclusive).</p><ul>`
    +c.costs.map(cost => `<li data-campaign-cost-id="${h(cost.id)}">${money(cost.amountCents)} · ${h(cost.occurredAt)} · ${h(cost.reference)}${cost.note ? ' · '+h(cost.note) : ''}</li>`).join('')
    +`</ul><p>These records describe actual spending. Strap sends no funds or campaign messages.</p>`
    +form('lead.campaign.cost',path,request()+hidden('campaignId',c.id)+field('amount','Recorded cost in USD','','number','required min="0.01" step="0.01"')
      +field('occurredAt','Cost occurred at (UTC)','','datetime-local','required')+field('reference','Spending reference','','text','required maxlength="500"')
      +textarea('note','Spending note','','maxlength="4000"'),'Record campaign cost','quiet')+'</details></article>').join('')
  const create = `<details><summary>Record an intro campaign</summary>`+form('lead.campaign.create',path,request()
    +field('name','Campaign name','','text','required maxlength="100"')
    +select('introOfferId','Campaign intro offer',offers.filter(o => o.active).map(o => [o.id,o.name]))
    +field('startsAt','Campaign starts at (UTC)','','datetime-local','required')+field('endsAt','Campaign ends at (UTC)','','datetime-local','required')
    +'<p>Assign the campaign when recording the first inquiry. Attribution stays with that inquiry; this record sends nothing.</p>','Record campaign','quiet')+'</details>'
  return panel('Intro campaigns',body((campaigns || '<p>No intro campaigns recorded.</p>')+create),{id:'intro-campaigns'})
}

import { list, type RecordData, type State } from './domain/types'

/** Read retained sale events; an external pipeline label grants no native sale. */
export function leadSales(state: State, personId: string, since: string, asOf: string, introOfferId?: string) {
  const within = (at: string) => at >= since && at <= asOf
  const intros = list(state,'introSale').filter(s => s.personId === personId && within(s.createdAt) && (!introOfferId || s.offerId === introOfferId))
  const packs = list(state,'pack').filter(p => p.personId === personId)
  const memberships = packs.filter(p => !p.introSaleId && !p.recurringTermsId && ['visits','unlimited'].includes(p.entitlement?.kind)
    && within(p.createdAt)).map(p => ({id:p.id,packId:p.id,kind:'fixed-term',at:p.createdAt}))
  const agreements = list(state,'recurringTerms').filter(t => t.personId === personId && t.acceptedAt && within(t.acceptedAt))
    .map(t => ({id:t.id,packId:t.packId,kind:'recurring-acceptance',at:t.acceptedAt}))
  const conversions = [...memberships,...agreements].sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  const introPackIds = new Set(intros.map(s => s.packId)), membershipPackIds = new Set(memberships.map(p => p.packId))
  const charges = list(state,'charge').filter(c => within(c.createdAt) && c.amountCents > 0 && (
    introPackIds.has(c.packId) && c.kind === 'intro' || membershipPackIds.has(c.packId) && (!c.reason && !c.kind || ['nurture_membership','winback_membership'].includes(c.reason))))
  return {intros,conversions,charges}
}

export function saleEvidence(sales: ReturnType<typeof leadSales>, personId: string, asOf: string) {
  const packUrl = (id: string) => '/app/packs?person='+encodeURIComponent(personId)+'#pack-'+encodeURIComponent(id)
  return {
    lapsedIntroSaleIds:sales.conversions.length ? [] : sales.intros.filter(s => s.expiresAt <= asOf).map(s => s.id),
    introPurchases:sales.intros.map(s => ({id:s.id,packId:s.packId,offerId:s.offerId,at:s.createdAt,amountCents:s.amountCents,url:packUrl(s.packId)})),
    nativeConversions:sales.conversions.map(c => ({...c,url:c.kind === 'recurring-acceptance' ? '/app/packs?person='+encodeURIComponent(personId)+'#recurring-'+encodeURIComponent(c.id) : packUrl(c.packId)})),
    revenueEvents:sales.charges.map((c:RecordData) => ({id:c.id,packId:c.packId,at:c.createdAt,amountCents:c.amountCents,url:'/app/packs?person='+encodeURIComponent(personId)+'&receipt='+encodeURIComponent(c.packId)+'#receipt-'+encodeURIComponent(c.packId)}))
  }
}

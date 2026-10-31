// STUDIO-001: the purchase receipt of a plan, a view of the retained sale. It names the business's legal identity, the
// sale location's address and US phone, the exact USD amounts charged and the sale time on that location's clock;
// members and staff read the same facts. It records the charge added to the balance: payments are recorded separately,
// and delivering a receipt by email or itemizing tax is BILL-009.
import { catalogTerms } from './product-catalog';
import { money } from './format'
import { packName } from './facts'
import { addressText } from './locations'
import { phoneText } from './profile'
import { cell, emptyLine, h, panel, person, rows, table } from './shared'

const saleTime = (at: string, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(at))

export function receipt(s: any, pack: any, staff: boolean) {
  const place = rows(s, 'locations').find(l => l.id === (pack.locationId ?? 'studio')), zone = place?.timeZone ?? s.studio?.timeZone ?? 'UTC'
  const lines: [string, number][] = [[packName(pack), pack.purchaseAmountCents ?? rows(s,'charges').find(c=>c.packId===pack.id&&!c.planChangeId&&!c.reason&&!c.kind)?.amountCents ?? pack.amountCents], ...(pack.initiationFeeCents ? [['One-time initiation fee', pack.initiationFeeCents] as [string, number]] : [])]
  const adjustments = rows(s,'charges').filter(c => c.packId === pack.id && (c.planChangeId || c.freezeId))
  const adjustmentLines = adjustments.map(c => {
    const change = s.planChanges?.changes.find((r: any) => r.id === c.planChangeId), freeze = s.freezes?.freezes.find((r: any) => r.id === c.freezeId)
    const label = change ? 'Plan change' : c.reversesChargeId ? 'Freeze fee reversal' : 'Freeze fee', effectiveAt = c.reversesChargeId ? c.createdAt : change?.effectiveAt ?? freeze?.startAt ?? c.createdAt
    return `<tr data-charge-id="${h(c.id)}">${cell('Item', h(label))}${cell('Effective', h(saleTime(effectiveAt,zone)))}${cell('Amount (USD)', money(c.amountCents), 'right')}</tr>`
  }).join('')
  const total = lines.reduce((n, [, cents]) => n + cents, 0)
  return `<article class="receipt panel-body" id="receipt-${h(pack.id)}" data-pack-id="${h(pack.id)}"><h3>${h(s.studio?.legalName ?? s.studio?.location ?? 'Studio')}</h3>`
    + `<p>${h(place?.name ?? s.studio?.location ?? 'Studio')} · ${h(addressText(place?.address))}${place?.phone ? ` · ${h(phoneText(place.phone))}` : ''}</p>`
    + `<p><time datetime="${h(pack.createdAt)}">${h(saleTime(pack.createdAt, zone))}</time>${staff ? ` · ${h(person(s, pack.personId))}` : ''}</p>`
    + `<div class="table-wrap">${table(['Item', '>Amount (USD)'], lines.map(([label, cents]) => `<tr>${cell('Item', h(label))}${cell('Amount (USD)', money(cents), 'right')}</tr>`).join('') + `<tr>${cell('Item', '<strong>Total charged</strong>')}${cell('Amount (USD)', `<strong>${money(total)}</strong>`, 'right')}</tr>`)}</div>`
    + catalogTerms(pack.catalogVersion)
    + (pack.proration ? `<p>First-term calculation: ${money(pack.proration.fullAmountCents)} × ${pack.proration.remainingSeconds} remaining ÷ ${pack.proration.totalSeconds} cycle seconds (UTC), rounded half-up to the cent. Join ${h(pack.proration.joinAt)}; cycle ${h(pack.proration.cycleStartAt)} to ${h(pack.proration.cycleEndAt)}.</p>` : '')
    + (adjustmentLines ? `<h4>Itemized adjustments</h4><div class="table-wrap">${table(['Item','Effective','>Amount (USD)'], adjustmentLines)}</div><p>Adjustments added to the studio balance: ${money(adjustments.reduce((n,c)=>n+c.amountCents,0))}. The original purchase total above stays unchanged. No payment collected.</p>` : '')
    + (s.studio?.receiptDetails ? `<p>${h(s.studio.receiptDetails)}</p>` : '')
    + `<p class="meta">Prices are in US dollars. This receipt records the charge added to the balance; a payment is recorded separately.</p></article>`
}

export function receiptsPanel(s: any, packs: any[], staff: boolean) {
  const list = [...packs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)
  return panel('Purchase receipts', list.length ? list.map(pack => receipt(s, pack, staff)).join('') : emptyLine('Receipts appear here when a plan is sold.'), { icon: 'report', id: 'receipts', className: 'history' })
}

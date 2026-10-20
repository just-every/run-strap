import { feesPanel } from './fees'
// Packs and payments: class packs and what members owe, recorded payments, and
// the forms that prepare packs and reminders, in dollars and calendar dates.
import { balance, packName } from './facts'
import { dayLong, money, studioToday, when } from './format'
import { approvalHistory, draftRecords } from './drafts'
import { avatar, body, cell, emptyLine, field, form, h, owner, panel, person, personSelect, rows, select, table, textarea } from './shared'
import { addDays } from '../zone'
import { packCreditCounts, packExpiration, packHistory } from './pack-history'
import { planChangesPanel } from './plan-changes'

/** How long a pack lasts, each with the last day it can be used. */
const terms = (s: any): [unknown, unknown][] => [30, 60, 90, 120, 180, 365].map(days => { const last = addDays(studioToday(s), days); return [last, `${days === 365 ? '1 year' : `${days} days`} · through ${dayLong(last).replace(/^(\w{3})\w*/, '$1')}`] })

export function packsPage(s: any, query: URLSearchParams) {
  const mine = !owner(s), chosen = query.get('person') ?? ''
  const packs = rows(s, 'packs').sort((a, b) => person(s, a.personId).localeCompare(person(s, b.personId)) || a.expiresAt.localeCompare(b.expiresAt))
  const live = (p: any) => p.remaining > 0 && Date.parse(p.expiresAt) > Date.now()
  const packTable = packs.length ? `<div class="table-wrap">${table([...(mine ? [] : ['Member']), 'Pack / services', 'Credits', 'Price', 'Expires'], packs.map(p => `<tr>${mine ? '' : cell('Member', `<div class="who">${avatar(person(s, p.personId))}<a href="/app/people?person=${encodeURIComponent(p.personId)}#person">${h(person(s, p.personId))}</a></div>`)}${cell('Pack / services', `<a href="#pack-${h(p.id)}">${h(packName(p))}</a><small>${h(p.eligibleServices?.join(', ') || 'All classes')}</small>`, 'bare')}${cell('Credits', packCreditCounts(p))}${cell('Price', money(p.amountCents))}${cell('Expires', `${packExpiration(s,p.expiresAt)}${Date.parse(p.expiresAt) <= Date.now() ? ' <small>Expired</small>' : ''}`)}</tr>`).join(''))}</div>` : emptyLine(mine ? 'You have no class packs. Ask the studio for one.' : 'No packs yet. Prepare a pack below and approve it to give a member credits.')
  const creditHistory = panel('Credit history', packHistory(s,packs,mine), { icon: 'report', className: 'history' })
  const owed = rows(s, 'people').filter(p => p.role === 'member' && balance(s, p.id) !== 0).sort((a, b) => balance(s, b.id) - balance(s, a.id))
  const balances = owed.length ? `<div class="table-wrap">${table(['Member', '>Owes'], owed.map(p => `<tr>${cell('Member', `<div class="who">${avatar(p.name)}<span>${h(p.name)}</span></div>`)}${cell('Owes', `<strong>${money(balance(s, p.id))}</strong>`, 'right')}</tr>`).join(''))}</div>` : emptyLine(mine ? `You owe nothing.` : 'Every member is paid up.')
  const payments = rows(s, 'payments').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const payHeads = ['Recorded', ...(mine ? [] : ['Member']), 'Reference', '>Amount']
  const payLine = (p: any) => `<tr>${cell('Recorded', when(s, p.createdAt))}${mine ? '' : cell('Member', h(person(s, p.personId)))}${cell('Reference', `${h(p.reference)}${p.kind === 'fee_receipt' ? '<small>Attendance fee received outside Strap</small>' : ''}${p.kind === 'refund' ? '<small>Refund paid back outside Strap</small>' : ''}`)}${cell('Amount', money(p.amountCents), 'right')}</tr>`
  const paymentTable = payments.length ? `<div class="table-wrap">${table(payHeads, payments.slice(0, 10).map(payLine).join(''))}</div>${payments.length > 10 ? `<details class="more"><summary>Show ${payments.length - 10} earlier payments</summary><div class="table-wrap">${table(payHeads, payments.slice(10).map(payLine).join(''))}</div></details>` : ''}` : emptyLine('No payments recorded yet.')
  const myBalance = mine ? panel('My balance', body(`<p class="credits-big"><b>${money(balance(s, s.actor.personId))}</b> owed</p>`), { icon: 'card' }) : ''
  if (mine) return `<div class="page"><div class="page-main"><div class="page-title"><h1>My packs</h1></div>${panel('Class packs', packTable, { icon: 'card' })}${planChangesPanel(s)}${feesPanel(s)}${creditHistory}${panel('Payments', paymentTable, { icon: 'report' })}</div><aside class="rail">${myBalance}</aside></div>`

  const forms = panel('Prepare a pack', body(`<p>A pack gives a member class credits and adds its price to what they owe. Review and approve it before the credits appear.</p>${form('pack.prepare', '/app/packs', `${personSelect(s, chosen)}<div class="row2">${field('credits', 'Class credits', '10', 'number', 'required min="1" max="10000" step="1"')}${field('amount', 'Price', '', 'text', 'required inputmode="decimal" placeholder="$189.00"')}</div>${textarea('eligibleServices', 'Eligible services (one per line; blank means all classes)', '', 'maxlength="16000" placeholder="Mat"')}${select('expiresOn', 'Good for', terms(s), addDays(studioToday(s), 90))}<label class="check"><input type="checkbox" name="priorityBooking" value="true"> Priority booking: books in a service’s priority window</label>`, 'Prepare pack')}`), { id: 'prepare-pack', icon: 'plus', className: 'desk-form' })
    + panel('Record a payment', body(`<p>Record money you received through your own processor. A reference is used once, so the same payment is never recorded twice.</p>${form('payment.record', '/app/packs', `${personSelect(s, chosen)}<div class="row2">${field('amount', 'Amount received', '', 'text', 'required inputmode="decimal" placeholder="$189.00"')}${field('reference', 'Payment reference', '', 'text', 'required maxlength="160" placeholder="SQ-4821"')}</div>`, 'Record payment')}`), { id: 'record-payment', icon: 'card', className: 'desk-form' })
    + panel('Prepare a balance reminder', body(`<p>The draft freezes the member’s balance and the exact message. Once approved you download it to send yourself; Strap sends no email for it.</p>${form('reminder.prepare', '/app/packs', personSelect(s, chosen), 'Prepare reminder')}`), { icon: 'chat', className: 'desk-form' })
  const drafts = draftRecords(s, '/app/packs', ['pack', 'reminder'])
  // Below 1280px the columns stack; pages.css puts the desk's forms after the prepared drafts.
  return `<div class="page desk"><div class="page-main"><div class="page-title"><h1>Packs and payments</h1><p>${packs.filter(live).length} active packs · ${owed.length} members owe</p></div>`
    + panel('Prepared packs and reminders', drafts.html, { count: drafts.waiting, icon: 'clock', id: 'drafts' })
    + planChangesPanel(s, chosen) + feesPanel(s) + panel('Class packs', packTable, { icon: 'card', className: 'history' }) + creditHistory + panel('Payment history', paymentTable, { icon: 'report', className: 'history' }) + panel('Approval history', approvalHistory(s, ['pack', 'reminder']), { icon: 'check', className: 'history' })
    + `</div><aside class="rail">${panel('Member balances', balances, { icon: 'users', className: 'balances' })}${forms}</aside></div>`
}

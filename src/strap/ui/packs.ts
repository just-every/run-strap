// Packs and payments: class packs and what members owe, recorded payments, and
// the forms that prepare packs and reminders, in dollars and calendar dates.
import { balance, packName } from './facts'
import { dayOf, datePlain, money, studioToday, when } from './format'
import { approvalHistory, draftRecords } from './drafts'
import { avatar, body, cell, emptyLine, field, form, h, owner, panel, person, personSelect, rows, table } from './shared'
import { addDays } from '../zone'

export function packsPage(s: any, query: URLSearchParams) {
  const mine = !owner(s), chosen = query.get('person') ?? ''
  const packs = rows(s, 'packs').sort((a, b) => person(s, a.personId).localeCompare(person(s, b.personId)) || a.expiresAt.localeCompare(b.expiresAt))
  const live = (p: any) => p.remaining > 0 && Date.parse(p.expiresAt) > Date.now()
  const packTable = packs.length ? `<div class="table-wrap">${table([...(mine ? [] : ['Member']), 'Pack', 'Credits left', 'Price', 'Good through'], packs.map(p => `<tr>${mine ? '' : cell('Member', `<div class="who">${avatar(person(s, p.personId))}<a href="/app/people?person=${encodeURIComponent(p.personId)}">${h(person(s, p.personId))}</a></div>`)}${cell('Pack', h(packName(p)), 'bare')}${cell('Credits left', `<span class="chip${live(p) ? '' : ' quiet'}">${p.remaining} of ${p.credits}</span>`)}${cell('Price', money(p.amountCents))}${cell('Good through', `${h(datePlain(dayOf(s, p.expiresAt)))}${Date.parse(p.expiresAt) <= Date.now() ? ' <small>Expired</small>' : ''}`)}</tr>`).join(''))}</div>` : emptyLine(mine ? 'You have no class packs. Ask the studio for one.' : 'No packs yet. Prepare a pack below and approve it to give a member credits.')
  const owed = rows(s, 'people').filter(p => p.role === 'member' && balance(s, p.id) !== 0).sort((a, b) => balance(s, b.id) - balance(s, a.id))
  const balances = owed.length ? `<div class="table-wrap">${table(['Member', '>Owes'], owed.map(p => `<tr>${cell('Member', `<div class="who">${avatar(p.name)}<span>${h(p.name)}</span></div>`)}${cell('Owes', `<strong>${money(balance(s, p.id))}</strong>`, 'right')}</tr>`).join(''))}</div>` : emptyLine(mine ? `You owe nothing.` : 'Every member is paid up.')
  const payments = rows(s, 'payments').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const payHeads = ['Recorded', ...(mine ? [] : ['Member']), 'Reference', '>Amount']
  const payLine = (p: any) => `<tr>${cell('Recorded', when(s, p.createdAt))}${mine ? '' : cell('Member', h(person(s, p.personId)))}${cell('Reference', h(p.reference))}${cell('Amount', money(p.amountCents), 'right')}</tr>`
  const paymentTable = payments.length ? `<div class="table-wrap">${table(payHeads, payments.slice(0, 10).map(payLine).join(''))}</div>${payments.length > 10 ? `<details class="more"><summary>Show ${payments.length - 10} earlier payments</summary><div class="table-wrap">${table(payHeads, payments.slice(10).map(payLine).join(''))}</div></details>` : ''}` : emptyLine('No payments recorded yet.')
  const myBalance = mine ? panel('My balance', body(`<p class="credits-big"><b>${money(balance(s, s.actor.personId))}</b> owed</p>`), { icon: 'card' }) : ''
  if (mine) return `<div class="page"><div class="page-main"><div class="page-title"><h1>My packs</h1></div>${panel('Class packs', packTable, { icon: 'card' })}${panel('Payments', paymentTable, { icon: 'report' })}</div><aside class="rail">${myBalance}</aside></div>`

  const expiry = addDays(studioToday(s), 90)
  const forms = panel('Prepare a pack', body(`<p>A pack gives a member class credits and adds its price to what they owe. Review and approve it before the credits appear.</p>${form('pack.prepare', '/app/packs', `${personSelect(s, chosen)}<div class="row2">${field('credits', 'Class credits', '10', 'number', 'required min="1" max="10000" step="1"')}${field('amount', 'Price', '', 'text', 'required inputmode="decimal" placeholder="$189.00"')}</div>${field('expiresOn', 'Good through', expiry, 'date', `required min="${studioToday(s)}"`, 'the last day it can be used')}`, 'Prepare pack')}`), { id: 'prepare-pack', icon: 'plus' })
    + panel('Record a payment', body(`<p>Record money you received through your own processor. A reference is used once, so the same payment is never recorded twice.</p>${form('payment.record', '/app/packs', `${personSelect(s, chosen)}<div class="row2">${field('amount', 'Amount received', '', 'text', 'required inputmode="decimal" placeholder="$189.00"')}${field('reference', 'Payment reference', '', 'text', 'required maxlength="160" placeholder="SQ-4821"')}</div>`, 'Record payment')}`), { id: 'record-payment', icon: 'card' })
    + panel('Prepare a balance reminder', body(`<p>The draft freezes the member’s balance and the exact message. Once approved you download it to send yourself; Strap sends no email for it.</p>${form('reminder.prepare', '/app/packs', personSelect(s, chosen), 'Prepare reminder')}`), { icon: 'chat' })
  const drafts = draftRecords(s, '/app/packs', ['pack', 'reminder'])
  return `<div class="page"><div class="page-main"><div class="page-title"><h1>Packs and payments</h1><p>${packs.filter(live).length} active packs · ${owed.length} members owe</p></div>`
    + panel('Prepared packs and reminders', drafts.html, { count: drafts.waiting, icon: 'clock', id: 'drafts' })
    + panel('Class packs', packTable, { icon: 'card' }) + panel('Payment history', paymentTable, { icon: 'report' }) + panel('Approval history', approvalHistory(s, ['pack', 'reminder']), { icon: 'check' })
    + `</div><aside class="rail">${panel('Member balances', balances, { icon: 'users' })}${forms}</aside></div>`
}

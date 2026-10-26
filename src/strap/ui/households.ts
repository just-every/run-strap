// MEM-002: households. The owner (front desk) sets up a household, links guardians and participants, keeps permissioned
// contacts and proposes a payer; a member sees only their own household. A guardian books and signs for the participants
// they are linked to; the payer's own acceptance is the step that makes them the payer.
import { balance, classTitle, upcoming } from './facts'
import { money, when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, panel, person, rows, select, table } from './shared'

const phone = (digits: string) => digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')
const pending = (hh: any) => hh.pendingPayer ? `<p><span class="pill pending">Waiting</span> ${h(hh.pendingPayer.name)} has been asked to become the payer. Nothing changes until they accept it themselves, signed in. Their own stored payment-method authorization is not available yet.</p>` : ''

function staffHousehold(s: any, hh: any) {
  const members = rows(s, 'people').filter(p => p.active && p.role === 'member')
  const inAnyHousehold = new Set(rows(s, 'households').flatMap(x => [...x.guardians.map((g: any) => g.id), ...x.participants.map((p: any) => p.id), ...(x.payer ? [x.payer.id] : [])]))
  const free = members.filter(p => !inAnyHousehold.has(p.id)), withEmail = free.filter(p => p.email)
  const back = '/app/households', id = hidden('id', hh.id)
  const guardians = hh.guardians.map((g: any) => `<tr>${cell('Guardian', `<strong>${h(g.name)}</strong><small>Evidence: ${h(hh.guardianEvidence?.[g.id]?.evidenceReference ?? '')}</small>`)}${cell('', form('household.guardian.remove', back, id + hidden('guardianId', g.id) + field('reason', 'Reason', '', 'text', 'maxlength="300"'), 'Remove guardian', 'quiet', 'small'))}</tr>`).join('')
  const kids = hh.participants.map((p: any) => `<tr>${cell('Participant', `<strong>${h(p.name)}</strong>`)}${cell('', form('household.participant.remove', back, id + hidden('participantId', p.id), 'Remove from household', 'quiet', 'small'))}</tr>`).join('')
  const contacts = hh.contacts.map((c: any) => `<tr>${cell('Contact', `<strong>${h(c.name)}</strong><small>${h(c.relationship ?? '')} · ${h(phone(c.phone))}</small>`)}${cell('May', h(c.permissions.join(', ') || 'nothing'))}${cell('', form('household.contact.remove', back, id + hidden('contactId', c.id), 'Remove', 'quiet', 'small'))}</tr>`).join('')
  const payer = hh.payer ? `<p>Payer: <strong>${h(hh.payer.name)}</strong>. Charges for the participants are added to their studio balance.</p>` : '<p>No payer yet: charges stay on each participant.</p>'
  return panel(hh.name, body(
    `<div data-household-id="${h(hh.id)}">`
    + `<h3>Guardians</h3>${guardians ? `<div class="table-wrap">${table(['Guardian', ''], guardians)}</div>` : emptyLine('No guardian linked.')}`
    + form('household.guardian.link', back, id + select('guardianId', 'Guardian (a member with an email)', [['', 'Choose a member'], ...withEmail.map(p => [p.id, `${p.name} (${p.email})`] as [string, string])]) + field('evidenceReference', 'Guardianship evidence you verified (reference)', '', 'text', 'required maxlength="160"'), 'Link guardian')
    + `<h3>Participants</h3>${kids ? `<div class="table-wrap">${table(['Participant', ''], kids)}</div>` : emptyLine('No participant yet.')}`
    + form('household.participant.add', back, id + select('personId', 'Existing member', [['', 'Add a new person instead'], ...free.map(p => [p.id, p.name] as [string, string])], '', '') + field('name', 'New person at the desk (no email)', '', 'text', 'maxlength="160"') + field('channel', 'Request received by', 'desk', 'text', 'maxlength="10"'), 'Add participant')
    + `<h3>Permissioned contacts</h3>${contacts ? `<div class="table-wrap">${table(['Contact', 'May', ''], contacts)}</div>` : emptyLine('No contacts.')}`
    + form('household.contact.save', back, id + field('name', 'Contact name', '', 'text', 'required maxlength="120"') + field('phone', 'Phone (US number)', '', 'tel', 'required maxlength="20"') + field('relationship', 'Relationship', '', 'text', 'maxlength="60"') + `<fieldset class="days"><legend>May</legend><label class="check"><input type="checkbox" name="perm_pickup" value="true"> Pick up</label><label class="check"><input type="checkbox" name="perm_emergency" value="true"> Be called in an emergency</label></fieldset>`, 'Save contact')
    + `<h3>Payer</h3>${payer}${pending(hh)}`
    + form('household.payer.propose', back, id + select('payerId', 'Make this person the payer', [['', 'Choose a member with an email'], ...withEmail.map(p => [p.id, `${p.name} (${p.email})`] as [string, string])]), 'Ask them to become the payer')
    + (hh.pendingPayer ? form('household.payer.cancel', back, id, 'Withdraw the request', 'quiet') : '')
    + '</div>'), { icon: 'users', id: `household-${hh.id}` })
}

export function householdsPage(s: any) {
  const list = rows(s, 'households')
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Households</h1><p>${list.length} ${list.length === 1 ? 'household' : 'households'}</p></div>`
    + panel('Create a household', body(`<p>A household keeps participants, the guardians who book and sign for them, permissioned contacts and one payer. Each person belongs to one household. A guardian sees only their participants' classes, bookings, waiver, plans and notices; the payer sees only the charges placed on their own balance.</p>${form('household.save', '/app/households', field('name', 'Household name', '', 'text', 'required maxlength="120" placeholder="The Okafor family"'), 'Create household')}`), { icon: 'plus' })
    + (list.length ? list.map(hh => staffHousehold(s, hh)).join('') : panel('No households yet', emptyLine('Create a household, then link its guardian and participants.'), { icon: 'users' }))
    + '</div></div>'
}

function guardianView(s: any, hh: any) {
  const back = '/app/household', classes = upcoming(s).filter((c: any) => c.status === 'published')
  const kid = (p: any) => {
    const seats = rows(s, 'bookings').filter(b => b.personId === p.id && b.status !== 'cancelled' && rows(s, 'classes').some(c => c.id === b.classId && c.start > new Date().toISOString()))
    const lines = seats.map(b => { const c = rows(s, 'classes').find(x => x.id === b.classId); return `<tr>${cell('Class', `<strong>${h(classTitle(c))}</strong><small>${when(s, c.start, c.timeZone)}</small>`)}${cell('Status', h(b.status))}${cell('', form('booking.cancel', back, hidden('id', b.id), 'Cancel', 'quiet', 'small'))}</tr>` }).join('')
    const signed = rows(s, 'acknowledgements').some(a => a.personId === p.id && a.waiverId === s.waiver?.id && (!s.waiver.requiresSignature || a.signature?.documentHash === s.waiver.documentHash))
    return `<div data-participant-id="${h(p.id)}"><h3>${h(p.name)}</h3>`
      + rows(s,'acknowledgements').filter(a=>a.personId===p.id).map(a=>`<p><a href="/api/strap/waiver-evidence.json?id=${h(a.id)}">Download ${h(p.name)} document evidence · ${h(a.signature?.documentVersion ?? a.waiverId)}</a></p>`).join('')
      + (s.waiver && !signed ? form('waiver.acknowledge', back, hidden('id', s.waiver.id) + hidden('participantId', p.id) + `<p class="letter">${h(s.waiver.text)}</p>` + (s.waiver.requiresSignature ? hidden('documentHash',s.waiver.documentHash) + field('signerName','Your full name',s.people.find((p: any)=>p.id===s.actor.personId)?.name ?? '', 'text','required maxlength="160"') + '<label class="check"><input type="checkbox" name="confirm" value="yes" required>I personally affirm this document as the recorded guardian. This does not authorize a payment.</label>' : ''), `Sign the waiver for ${p.name}`) : s.waiver ? '<p><span class="pill done">Waiver completed</span></p>' : '')
      + form('booking.book', back, hidden('participantId', p.id) + select('classId', 'Book a class', [['', 'Choose a class'], ...classes.map((c: any) => [c.id, `${classTitle(c)} · ${when(s, c.start, c.timeZone).replace(/<[^>]+>/g, '')}`] as [string, string])]), `Book ${p.name}`)
      + (lines ? `<div class="table-wrap">${table(['Class', 'Status', ''], lines)}</div>` : emptyLine('No upcoming bookings.')) + '</div>'
  }
  return hh.participants.map(kid).join('') + (hh.contacts.length ? `<h3>Permissioned contacts</h3>${hh.contacts.map((c: any) => `<p>${h(c.name)} (${h(c.relationship ?? '')}) · ${h(phone(c.phone))} · may ${h(c.permissions.join(', ') || 'nothing')}</p>`).join('')}` : '')
    + form('household.guardian.leave', back, hidden('id', hh.id), 'Stop being a guardian in this household', 'quiet')
}

export function householdPage(s: any) {
  const mine = rows(s, 'households')
  const view = (hh: any) => {
    const asked = hh.pendingPayer?.personId === s.actor.personId
      ? `<div data-payer-request><p>The studio asked you to become the payer for ${h(hh.participants.map((p: any) => p.name).join(', ') || 'this household')}. If you accept, their charges are added to your studio balance. Your own stored payment-method authorization is a separate step that is not available yet.</p>${form('household.payer.accept', '/app/household', hidden('id', hh.id), 'Accept responsibility as payer')}</div>` : ''
    const role = hh.role === 'proposed payer' ? ''
      : hh.role === 'guardian' ? guardianView(s, hh)
      : hh.role === 'payer' ? `<p>You are the payer. Charges for ${h(hh.participants.map((p: any) => p.name).join(', '))} are added to your studio balance, now ${money(balance(s, s.actor.personId))}.</p>`
      : `<p>You are a participant. ${hh.guardians.length ? `Guardians: ${h(hh.guardians.map((g: any) => g.name).join(', '))}.` : ''} ${hh.payer ? `Payer: ${h(hh.payer.name)}.` : ''}</p>`
    return panel(hh.name, body(`<p class="meta">Your role: ${h(hh.role)}</p>${hh.role === 'guardian' && !asked ? pending(hh) : ''}${asked}${role}`), { icon: 'users', id: `household-${hh.id}` })
  }
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>My household</h1><p>You see only your own household.</p></div>${mine.map(view).join('') || panel('No household', emptyLine('You are not part of a household.'), { icon: 'users' })}</div></div>`
}

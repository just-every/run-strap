import { empty, field, form, h, hidden, initials, matPanel, panel, row, rows, select, status } from './shared'

const personFields = (p?: any) => field('name', 'Full name', p?.name, 'text', 'required autocomplete="name"') + field('email', 'Email', p?.email, 'email', 'required autocomplete="email"') + select('role', 'Role', [['member', 'Member'], ['instructor', 'Instructor']], p?.role ?? 'member') + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], p ? String(p.active) : 'true')

export function people(s: any) {
 const list = rows(s, 'people').map(p => row({
  lead: initials(p.name),
  title: p.name,
  sub: h(p.email),
  meta: `<span class="role">${h(p.role)}</span>${status(p.active ? 'Active' : 'Inactive')}`,
  actions: p.active ? form('person.invite', '/app/people', hidden('id', p.id), 'Invite to sign in', 'secondary') : '',
  more: `<details><summary>Edit person</summary><p class="meta">ID: ${h(p.id)}</p>${form('person.save', '/app/people', hidden('id', p.id) + personFields(p), 'Save person')}</details><details><summary>Erase personal data</summary><p class="meta">Only unused, uninvited, non-imported people can be erased. Deactivate people with bookings or financial history to revoke access.</p>${form('person.erase', '/app/people', hidden('id', p.id) + '<label><input type="checkbox" required>I understand this erases personal data.</label>', 'Erase this person', 'secondary')}</details>`,
 })).join('')
 return `<h1>People</h1><p class="lede">Manage studio members and instructors, then invite each person to sign in using their email.</p><div class="columns"><div class="col-main">${matPanel('Studio people', list || empty('Add your first member or instructor using the form.'))}</div><div class="col-aside">${panel('Add a person', form('person.save', '/app/people', personFields(), 'Add person'))}</div></div>`
}

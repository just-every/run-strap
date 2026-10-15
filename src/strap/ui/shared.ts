const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const h = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => escapes[c])
export const rows = (s: any, key: string): any[] => Array.isArray(s[key]) ? s[key] : []
export const owner = (s: any) => s.actor.role === 'owner'
export const person = (s: any, id: unknown) => rows(s, 'people').find(p => p.id === id)?.name ?? id ?? '—'
export const hidden = (name: string, value: unknown) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`
export const field = (name: string, label: string, value: unknown = '', type = 'text', attrs = '') => `<label>${h(label)}<input name="${h(name)}" type="${h(type)}" value="${h(value)}" ${attrs}></label>`
export const textarea = (name: string, label: string, value: unknown = '', attrs = '') => `<label>${h(label)}<textarea name="${h(name)}" ${attrs}>${h(value)}</textarea></label>`
export const select = (name: string, label: string, choices: [unknown, unknown][], value: unknown = '') => `<label>${h(label)}<select name="${h(name)}" required>${choices.map(([id, text]) => `<option value="${h(id)}" ${id === value ? 'selected' : ''}>${h(text)}</option>`).join('')}</select></label>`
export const personSelect = (s: any, role = 'member') => select('personId', 'Person', [['', 'Choose a person'], ...rows(s, 'people').filter(p => p.active && p.role === role).map(p => [p.id, p.name] as [unknown, unknown])])
export const form = (command: string, path: string, body: string, button: string) => `<form method="post" action="/app/action?name=${encodeURIComponent(command)}&amp;returnTo=${encodeURIComponent(path)}">${body}<button type="submit">${h(button)}</button></form>`
export const panel = (title: string, body: string) => `<section class="panel"><h2>${h(title)}</h2>${body}</section>`
export const empty = (message: string) => `<p class="empty">${h(message)}</p>`
export const exact = (value: unknown) => `<pre>${h(JSON.stringify(value, null, 2))}</pre>`
export const status = (value: unknown) => `<span class="status">${h(value)}</span>`
export const stamp = (value: unknown) => {
 if (!value) return '—'
 const iso = typeof value === 'number' ? new Date(value).toISOString() : String(value)
 return `<time datetime="${h(iso)}">${h(iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC').replace(/Z$/, ' UTC'))}</time>`
}
export const money = (value: unknown) => `${(Number(value ?? 0) / 100).toFixed(2)}`
export const entry = (title: string, body: string) => `<article class="entry"><h3>${h(title)}</h3>${body}</article>`
export const result = (notice: any) => notice.result?.result ?? notice.result

export function approvals(s: any) {
 return panel('Approval history', rows(s, 'approvals').length ? rows(s, 'approvals').map(a => entry(`${a.type} · ${a.id}`, exact(a))).join('') : empty('Approved class weeks, packs and reminders will appear here.'))
}

export function drafts(s: any, path: string, kinds: string[]) {
 const items = rows(s, 'drafts').filter(d => kinds.includes(d.type))
 return panel('Prepared drafts', items.length ? items.map(d => entry(`${d.type} · ${d.id}`, `${status(d.status)}${exact(d)}${owner(s) && d.status === 'draft' ? form(d.type === 'classes' ? 'classes.publish' : d.type === 'pack' ? 'pack.approve' : 'reminder.approve', path, hidden('id', d.id), d.type === 'classes' ? 'Approve and publish this exact week' : d.type === 'pack' ? 'Approve this exact pack' : 'Approve this exact reminder') : ''}${owner(s) && d.type === 'reminder' && d.status === 'approved' ? `<p><a href="/api/strap/reminders/${h(d.id)}.txt">Download approved reminder</a></p>` : ''}`)).join('') : empty('Prepare a draft first. Its exact contents will be shown here before approval.'))
}

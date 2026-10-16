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

/**
 * A command form. One with no visible fields is a lone action button; the
 * secondary (outlined) style is for undoing, revoking and erasing.
 */
export const form = (command: string, path: string, body: string, button: string, style: 'primary' | 'secondary' = 'primary') => `<form class="${/<(label|textarea|select)\b/.test(body) ? 'fields' : 'act'}" method="post" action="/app/action?name=${encodeURIComponent(command)}&amp;returnTo=${encodeURIComponent(path)}">${body}<button class="${style === 'primary' ? 'btn' : 'btn-outline'}" type="submit">${h(button)}</button></form>`

/** A plain white panel. */
export const panel = (title: string, body: string, id = '') => `<section class="panel card"${id ? ` id="${h(id)}"` : ''}><h2>${h(title)}</h2>${body}</section>`
/** The screen's one primary panel, resting on a frame of berry mat. */
export const matPanel = (title: string, body: string) => `<section class="mat-surface mat"><div class="panel card"><h2>${h(title)}</h2>${body}</div></section>`
export const empty = (message: string) => `<p class="empty">${h(message)}</p>`
/** A screen with nothing in it yet: a flat mat holding the real message and its one action. */
export const emptyMat = (message: string, action = '') => `<section class="empty-mat mat roll-end"><div class="card"><p>${h(message)}</p>${action}</div></section>`
export const exact = (value: unknown) => `<pre>${h(JSON.stringify(value, null, 2))}</pre>`

const pillStyles: Record<string, string> = {
 active: 'solid', approved: 'solid', completed: 'solid', published: 'solid', 'checked in': 'solid',
 booked: 'tint', draft: 'tint',
 waitlisted: 'outline', queued: 'outline', applying: 'outline', undoing: 'outline', 'rolling back': 'outline',
 failed: 'alert',
}
/** A status pill: stored lowercase values show capitalised. */
export const status = (value: unknown) => {
 const text = String(value ?? '').replace(/_/g, ' ')
 const label = text.charAt(0).toUpperCase() + text.slice(1)
 const style = /^version /i.test(text) ? 'tint' : pillStyles[text.toLowerCase()] ?? 'muted'
 return `<span class="pill ${style}">${h(label)}</span>`
}
/** Stored instants, to the minute, in UTC. */
export const stamp = (value: unknown) => {
 if (!value) return '—'
 const iso = typeof value === 'number' ? new Date(value).toISOString() : String(value)
 const shown = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) && /(Z|\.\d{3}Z)$/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.replace('T', ' ')
 return `<time datetime="${h(iso)}">${h(shown)}</time>`
}
export const money = (value: unknown) => `${(Number(value ?? 0) / 100).toFixed(2)}`
export const initials = (name: unknown) => `<span class="initials" aria-hidden="true">${h(String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '·')}</span>`

/** One list row: an optional lead, the title and its lines, meta, actions, then anything below. */
export const row = (parts: { title: string; lead?: string; sub?: string; meta?: string; actions?: string; more?: string; current?: boolean }) =>
 `<article class="row${parts.current ? ' current' : ''}">${parts.lead ?? ''}<div class="row-main"><h3>${h(parts.title)}</h3>${parts.sub ? `<p class="row-sub">${parts.sub}</p>` : ''}</div>${parts.meta ? `<p class="row-meta">${parts.meta}</p>` : ''}${parts.actions ? `<div class="row-actions">${parts.actions}</div>` : ''}${parts.more ? `<div class="row-more">${parts.more}</div>` : ''}</article>`
export const entry = (title: string, body: string) => row({ title, more: body })
export const result = (notice: any) => notice.result?.result ?? notice.result

export function approvals(s: any) {
 return panel('Approval history', rows(s, 'approvals').length ? rows(s, 'approvals').map(a => entry(`${a.type} · ${a.id}`, exact(a))).join('') : empty('Approved class weeks, packs and reminders will appear here.'))
}

export function drafts(s: any, path: string, kinds: string[]) {
 const items = rows(s, 'drafts').filter(d => kinds.includes(d.type))
 return panel('Prepared drafts', items.length ? items.map(d => row({
  title: `${d.type} · ${d.id}`,
  actions: status(d.status),
  more: `${exact(d)}${owner(s) && d.status === 'draft' ? form(d.type === 'classes' ? 'classes.publish' : d.type === 'pack' ? 'pack.approve' : 'reminder.approve', path, hidden('id', d.id), d.type === 'classes' ? 'Approve and publish this exact week' : d.type === 'pack' ? 'Approve this exact pack' : 'Approve this exact reminder') : ''}${owner(s) && d.type === 'reminder' && d.status === 'approved' ? `<p><a href="/api/strap/reminders/${h(d.id)}.txt">Download approved reminder</a></p>` : ''}`,
 })).join('') : empty('Prepare a draft first. Its exact contents will be shown here before approval.'))
}

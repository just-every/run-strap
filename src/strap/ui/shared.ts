import { icon } from './icons'

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const h = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => escapes[c])
export const rows = (s: any, key: string): any[] => Array.isArray(s[key]) ? s[key] : []
export const owner = (s: any) => s.actor.role === 'owner'
export const personOf = (s: any, id: unknown) => rows(s, 'people').find(p => p.id === id)
export const person = (s: any, id: unknown) => personOf(s, id)?.name ?? 'Former member'
export const hidden = (name: string, value: unknown) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`

/** A labelled control. `hint` is quiet text after the label. */
export const field = (name: string, label: string, value: unknown = '', type = 'text', attrs = '', hint = '') =>
  `<label class="field"><span>${h(label)}${hint ? ` <span class="hint">${h(hint)}</span>` : ''}</span><input name="${h(name)}" type="${h(type)}" value="${h(value)}" ${attrs}></label>`
export const textarea = (name: string, label: string, value: unknown = '', attrs = '') => `<label class="field">${h(label)}<textarea name="${h(name)}" ${attrs}>${h(value)}</textarea></label>`
export const select = (name: string, label: string, choices: [unknown, unknown][], value: unknown = '', attrs = 'required') =>
  `<label class="field">${h(label)}<select name="${h(name)}" ${attrs}>${choices.map(([id, text]) => `<option value="${h(id)}"${id === value ? ' selected' : ''}>${h(text)}</option>`).join('')}</select></label>`
export const personSelect = (s: any, selected: unknown = '', label = 'Member') => select('personId', label, [['', 'Choose a member'], ...rows(s, 'people').filter(p => p.active && p.role === 'member').sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.id, p.name] as [unknown, unknown])], selected)

/**
 * A command form posted to /app/action. One with no visible fields is a lone
 * button; `quiet` is the white button for reviewing, undoing and revoking.
 */
export const form = (command: string, path: string, body: string, button: string, style: 'primary' | 'quiet' = 'primary', size = '') =>
  `<form class="${/<(label|textarea|select|table)\b/.test(body) ? 'form' : 'inline-form'}" method="post" action="/app/action?name=${encodeURIComponent(command)}&amp;returnTo=${encodeURIComponent(path)}">${body}<button class="${style === 'primary' ? 'btn' : 'btn-quiet'}${size ? ' ' + size : ''}" type="submit">${h(button)}</button></form>`

/** A white panel with a serif heading, an optional icon, count and right-hand note. */
export const panel = (title: string, body: string, options: { id?: string; icon?: string; count?: number; note?: string; className?: string } = {}) =>
  `<section class="panel${options.className ? ' ' + options.className : ''}"${options.id ? ` id="${h(options.id)}"` : ''}><div class="panel-head">${options.icon ? icon(options.icon) : ''}<h2>${h(title)}</h2>${options.count ? `<span class="badge">${options.count}</span>` : ''}${options.note ? `<p>${options.note}</p>` : ''}</div>${body}</section>`
export const body = (html: string) => `<div class="panel-body">${html}</div>`
/** A page's empty state: an icon, what is missing and the one thing to do. */
export const emptyState = (glyph: string, title: string, text: string, action = '') => `<div class="empty">${icon(glyph)}<h2>${h(title)}</h2><p>${h(text)}</p>${action}</div>`
export const emptyLine = (text: string) => `<p class="empty-line">${h(text)}</p>`

export const initials = (name: unknown) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '·'
export const avatar = (name: unknown, extra = '') => `<span class="avatar${extra ? ' ' + extra : ''}" aria-hidden="true">${h(initials(name))}</span>`

/** A stored state as a pill: "approved" → "Approved". */
export function statusPill(value: unknown) {
  const text = String(value ?? '').replace(/_/g, ' '), label = text.charAt(0).toUpperCase() + text.slice(1)
  const tone = ({ 'needs approval': 'pending', active: 'done', approved: 'done', completed: 'done', published: 'done', draft: 'pending', queued: 'pending', applying: 'pending', undoing: 'pending', 'rolling back': 'pending', failed: 'alert', revoked: 'quiet', expired: 'quiet', inactive: 'quiet' } as Record<string, string>)[text.toLowerCase()] ?? 'quiet'
  return `<span class="pill ${tone}">${h(label)}</span>`
}
export const result = (notice: any) => notice.result?.result ?? notice.result
/** A table with a header row; `stack` cells carry their column name for phones. */
export const table = (heads: string[], body: string, stack = true) =>
  `<table class="data${stack ? ' stack' : ''}"><thead><tr>${heads.map(head => `<th${head.startsWith('>') ? ' class="right"' : ''}>${h(head.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`
export const cell = (label: string, html: string, className = '') => `<td data-label="${h(label)}"${className ? ` class="${className}"` : ''}>${html}</td>`

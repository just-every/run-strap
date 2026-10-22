import { locationChoices, manyLocations } from './facts'
import { schedulingConflicts, type SchedulingConflict } from '../domain/scheduling'
import { when } from './format'
import { body, cell, emptyLine, field, form, h, hidden, panel, rows, select, table, textarea } from './shared'

export function allocationDetails(c: any) {
  const equipment = (c.equipment ?? []).length ? `<small>Equipment / reformers: ${h(c.equipment.join(', '))}</small>` : ''
  const buffers = c.bufferBeforeMinutes || c.bufferAfterMinutes ? `<small>Preparation: ${h(c.bufferBeforeMinutes ?? 0)} min before · ${h(c.bufferAfterMinutes ?? 0)} min after</small>` : ''
  return equipment + buffers
}

export function draftConflicts(s: any, d: any) {
  return schedulingConflicts(d.classes, rows(s, 'classes').filter(c => !d.recommendation || c.id !== d.before?.id), rows(s, 'unavailability'))
}

/** The exact blocking records remain visible after another request wins a race. */
export function conflictDetails(s: any, conflicts: SchedulingConflict[]) {
  if (!conflicts.length) return ''
  return `<div role="alert"><p><strong>Resolve these scheduling conflicts before publication.</strong></p>${table(['Class', 'Resource', 'Conflicting record', 'Occupied interval'], conflicts.map(c =>
    `<tr>${cell('Class', h(c.classTitle))}${cell('Resource', `${h(c.resource.kind)}: ${h(c.resource.label)}`)}${cell('Conflicting record', `<strong>${h(c.recordKind === 'class' ? c.record.title : c.record.reason)}</strong><small>${h(c.recordKind === 'class' ? 'Class' : 'Unavailable')} · ${h(c.record.id)}</small>`)}${cell('Occupied interval', `${when(s, c.occupiedStart)} – ${when(s, c.occupiedEnd)}`)}</tr>`).join(''))}</div>`
}

export function availabilityPanel(s: any) {
  const entries = rows(s, 'unavailability').filter(r => r.status === 'active').sort((a, b) => a.start.localeCompare(b.start))
  const list = entries.length ? `<div class="table-wrap">${table(['Resource', 'Unavailable', 'Reason', ''], entries.map(r => `<tr>${cell('Resource', `${h(r.resourceKind)}: ${h(r.resourceName)}`)}${cell('Unavailable', `${when(s, r.start, r.timeZone)} – ${when(s, r.end)}`)}${cell('Reason', h(r.reason))}${cell('', form('scheduling.unavailable.remove', '/app/classes', hidden('id', r.id), 'Remove', 'quiet'), 'right')}</tr>`).join(''))}</div>` : emptyLine('No availability exceptions recorded.')
  const instructors = rows(s, 'people').filter(p => p.active && p.role === 'instructor')
  const editor = s.studio ? form('scheduling.unavailable.save', '/app/classes',
    select('resourceKind', 'Resource type', [['instructor', 'Instructor'], ['room', 'Room'], ['equipment', 'Equipment / reformer']], 'instructor')
    + select('instructorId', 'Instructor (for instructor exceptions)', instructors.map(p => [p.id, p.name]), '', '')
    + (manyLocations(s) ? select('locationId', 'Location (for a room or equipment exception)', locationChoices(s), 'studio', '') : '')
    + field('resourceId', 'Room or equipment / reformer name', '', 'text', 'maxlength="100"')
    + field('startDate', 'From date', '', 'date', 'required') + field('startTime', 'From time', '', 'time', 'required')
    + field('endDate', 'Until date', '', 'date', 'required') + field('endTime', 'Until time', '', 'time', 'required')
    + textarea('reason', 'Reason (owner only)', '', 'required maxlength="300"'), 'Record unavailable time') : '<p>Set the studio’s time zone in Studio settings before recording unavailable time.</p>'
  return panel('Availability exceptions', list + `<details class="more"><summary>Record unavailable time</summary>${body(`<p class="meta">Times use the studio’s clock. Classes, including preparation and cleanup, cannot overlap unavailable time. An exception cannot overlap a published class.</p>${editor}`)}</details>`, { icon: 'clock' })
}

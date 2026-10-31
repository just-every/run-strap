import { humanOwner, insist, type RecordData } from './domain/types'
import { localDate } from './zone'
import { csv } from './spreadsheet'

export const historyFilters = ['person','auditActor','auditRight','auditChannel','auditCommand','auditFrom','auditTo'] as const
export const historyColumns = ['id','at','personId','actorId','actorRole','command','action','right','channel','reason','sourceKind','sourceId','version','sessionId','locationId','erased','before','after'] as const

/** One projection of the existing canonical staff history; reads never create or alter an event. */
export function staffHistory(s: any, query: URLSearchParams) {
  humanOwner(s.actor)
  const timeZone = s.studio?.timeZone ?? 'UTC'
  const filters = Object.fromEntries(historyFilters.map(key => [key,query.get(key) ?? '']))
  for (const value of Object.values(filters)) insist(value.length <= 160,'invalid_history_filter')
  for (const key of ['auditFrom','auditTo']) {
    const value = filters[key]
    insist(!value || (/^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value),'invalid_history_date')
  }
  insist(!filters.auditFrom || !filters.auditTo || filters.auditFrom <= filters.auditTo,'invalid_history_range')
  const events: RecordData[] = [...(s.staffActions ?? []),...(s.studioAudit ?? [])]
  const rows = events.filter(event => {
    const date = localDate(event.at,timeZone)
    return (!filters.person || event.personId === filters.person)
      && (!filters.auditActor || event.actorId === filters.auditActor)
      && (!filters.auditRight || event.right === filters.auditRight)
      && (!filters.auditChannel || event.channel === filters.auditChannel)
      && (!filters.auditCommand || (event.command ?? event.action) === filters.auditCommand)
      && (!filters.auditFrom || date >= filters.auditFrom) && (!filters.auditTo || date <= filters.auditTo)
  }).sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
  return {timeZone,filters,rows}
}

/** Export only audit facts, excluding replay payloads and command results. */
export function historyExport(s: any, query: URLSearchParams) {
  const report = staffHistory(s,query)
  return {...report,rows:report.rows.map(event => Object.fromEntries(historyColumns.map(key => [key,
    key === 'command' ? event.command ?? event.action : key === 'erased' ? !!event.erased :
      (key === 'before' || key === 'after') && event.erased ? null : event[key] ?? null
  ])))}
}

export function historyCsv(s: any, query: URLSearchParams) {
  return csv([[...historyColumns],...historyExport(s,query).rows.map(event => historyColumns.map(key =>
    (key === 'before' || key === 'after') && event[key] !== null ? JSON.stringify(event[key]) : event[key]
  ))])
}

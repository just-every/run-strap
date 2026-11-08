import { list, type RecordData, type State } from './domain/types'

/** Project retained sources, never today's authority or drawer balance. */
export function studioAudit(state: State): RecordData[] {
  const requests = list(state,'retailAction')
  return [
    ...list(state,'staffAccessEvent').map(event => ({
      ...event, sourceKind:'staffAccessEvent', sourceId:event.id,
      action:'staff.access.change', command:event.command ?? 'staff.access.change',
      actorRole:event.actorRole ?? null, right:'access', channel:event.channel ?? null,
      reason:event.reason ?? null,
    })),
    ...list(state,'drawerAdjustment').map(event => {
      // Old count adjustments retained their exact result identity. Old reopens
      // did not: absent facts stay unavailable rather than inferred by time.
      const request = requests.find(row => row.actorId === event.actorId &&
        (row.sourceKind === 'drawerAdjustment' && row.sourceId === event.id ||
          row.action === 'drawer.adjust' && row.result?.id === event.id))
      const command = event.action === 'reopen' ? 'drawer.reopen' : 'drawer.adjust'
      return {...event, sourceKind:'drawerAdjustment', sourceId:event.id,
        at:event.createdAt, personId:null, command, action:command,
        actorRole:event.actorRole ?? request?.role ?? null, version:event.version ?? null,
        right:'drawer', channel:event.channel ?? null, after:event.after ?? null}
    }),
  ]
}

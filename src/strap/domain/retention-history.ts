import { humanOwner, insist, instant, integer, list, now, person, record, text, type State } from './types'
import type { Transaction } from './store'

/** Historical observations are reporting inputs, never access, balance or collection authority. */
async function reviewedHistory(state: State, input: Record<string,unknown>) {
  let source: any
  try { source = typeof input.history === 'string' ? JSON.parse(input.history) : input.history } catch { insist(false,'invalid_history_json') }
  insist(source && typeof source === 'object' && !Array.isArray(source),'invalid_history')
  insist(source.format === 'strap-retention-history-v1','invalid_history_format')
  const member = person(state,text(source.personId,'personId',100),false)
  insist(member.role === 'member','member_required')
  const cutover = record(state,source.cutoverPackId,'pack')
  const firstNative = list(state,'pack').filter(p => p.personId === member.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]
  insist(cutover.personId === member.id && firstNative?.id === cutover.id && !cutover.renewedFromPackId,'invalid_history_cutover')
  insist(Array.isArray(source.terms) && source.terms.length > 0 && source.terms.length <= 120,'invalid_history_terms')
  const ids = new Set<string>()
  const terms = source.terms.map((value: any) => {
    insist(value && typeof value === 'object' && !Array.isArray(value),'invalid_history_term')
    const sourceId = text(value.sourceId,'sourceId',100), startsAt = instant(value.startsAt,'startsAt'), endsAt = instant(value.endsAt,'endsAt')
    insist(!ids.has(sourceId) && startsAt < endsAt && endsAt <= cutover.createdAt,'invalid_history_chronology')
    ids.add(sourceId)
    insist(typeof value.renewed === 'boolean','invalid_history_renewed')
    const terminationReason = value.terminationReason == null ? null : text(value.terminationReason,'terminationReason',50)
    insist(!terminationReason || !value.renewed,'terminated_history_cannot_renew')
    return {sourceId,startsAt,endsAt,offer:text(value.offer,'offer',80),contractReference:text(value.contractReference,'contractReference',200),
      paymentReference:text(value.paymentReference,'paymentReference',200),amountCents:integer(value.amountCents,'amountCents',0,100000000),
      paidCents:integer(value.paidCents,'paidCents',0,100000000),attendedVisits:integer(value.attendedVisits,'attendedVisits',0,100000),renewed:value.renewed,terminationReason}
  }).sort((a: any,b: any) => a.startsAt.localeCompare(b.startsAt) || a.sourceId.localeCompare(b.sourceId))
  insist(terms.every((term: any,i: number) => i === 0 || terms[i-1].endsAt <= term.startsAt),'overlapping_history_terms')
  const normalized = {format:'strap-retention-history-v1',personId:member.id,source:text(source.source,'source',100),
    definitionDifferences:text(source.definitionDifferences,'definitionDifferences',2000),cutoverPackId:cutover.id,terms}
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(normalized))))].map(b => b.toString(16).padStart(2,'0')).join('')
  return {history:normalized,fingerprint}
}
export async function previewRetentionHistory(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who)
  return reviewedHistory(tx.state,input)
}
export async function importRetentionHistory(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who)
  const reviewed = await reviewedHistory(tx.state,input)
  insist(input.fingerprint === reviewed.fingerprint,'history_preview_changed',409)
  const prior = list(tx.state,'retentionHistory').find(h => h.personId === reviewed.history.personId)
  if (prior) { insist(prior.fingerprint === reviewed.fingerprint,'history_already_imported',409); return prior }
  const saved = {id:'retention-history-'+reviewed.fingerprint,...reviewed.history,fingerprint:reviewed.fingerprint,importedAt:now(),importedBy:tx.who.id}
  tx.put('retentionHistory',saved)
  return saved
}

/** A separate projection leaves native inventory and balances untouched. */
export function historyProjection(state: State) {
  const histories = list(state,'retentionHistory')
  const packs = histories.flatMap(history => history.terms.map((term: any) => ({id:history.id+':'+term.sourceId,personId:history.personId,
    createdAt:term.startsAt,termStartAt:term.startsAt,expiresAt:term.endsAt,amountCents:term.amountCents,entitlement:{kind:'credits',name:term.offer},historyId:history.id,sourceTerm:term,history})))
  const changes = histories.flatMap(history => history.terms.flatMap((term: any,i: number) => term.renewed ? [{id:history.id+':renewal:'+term.sourceId,
    packId:history.id+':'+term.sourceId,mode:'renewal',status:'applied',appliedPackId:i+1 < history.terms.length ? history.id+':'+history.terms[i+1].sourceId : history.cutoverPackId,historyId:history.id}] : []))
  const nativePacks = list(state,'pack').map(pack => {
    const history = histories.find(h => h.cutoverPackId === pack.id && h.terms.at(-1)?.renewed)
    return history ? {...pack,renewedFromPackId:history.id+':'+history.terms.at(-1).sourceId} : pack
  })
  const historicalPacks = packs.map(pack => ({...pack,renewedFromPackId:changes.find(c => c.appliedPackId === pack.id)?.packId}))
  return {histories,packs:[...nativePacks,...historicalPacks],changes}
}

import { insist } from '../domain/types'
import type { Json } from './model'

/** Human-readable text is signed; the complete source object remains separately retained. */
export function membershipDocument(title: string,additional: string,original: Json,terms: Json) {
  insist(typeof original.consent==='string'&&typeof original.cancellation==='string'&&typeof original.memberName==='string','original_agreement_copy_incomplete',409)
  const dollars=(cents: number)=>'$'+(cents/100).toFixed(2)+' USD'
  const date=(value: string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeStyle:'short',timeZone:terms.timeZone}).format(new Date(value))+' ('+terms.timeZone+')'
  return [title,additional,
    'Original accepted studio invoice agreement',
    'Member: '+original.memberName,
    'Original acceptance: '+date(original.acceptedAt),
    'Original invoice price: '+dollars(original.priceCents)+' every '+original.intervalMonths+' calendar month(s).',
    'Original one-time initiation fee: '+dollars(original.originalInitiationFeeCents)+'.',
    'Original consent:\n'+original.consent,
    'Original cancellation terms:\n'+original.cancellation,
    'This additional document preserves the original studio agreement and its cancellation rights. Its complete retained source is included in the evidence download.',
    'Separate recurring-payment permission',
    'Amount: '+dollars(terms.amountCents)+' every '+terms.intervalMonths+' calendar month(s).',
    'First stated due date: '+date(terms.firstDueAt)+'.',
    'Original paid service period: '+date(terms.servicePeriod.startAt)+' to '+date(terms.servicePeriod.endAt)+'.',
    'Eligible services: '+(terms.eligibleServices.length?terms.eligibleServices.join(', '):'As covered by the original accepted plan')+'.',
    terms.meaning,
    'To revoke future payment permission: open My packs and choose Revoke future payment permission on this agreement. No studio visit or staff approval is required.',
    'Original studio agreement SHA-256: '+terms.originalAgreementHash,
  ].join('\n\n')
}

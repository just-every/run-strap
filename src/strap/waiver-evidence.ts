import { guardianOf } from './domain/households';
import { insist, record, type Actor, type State } from './domain/types';

/** Evidence stays private to the participant, a currently authorized guardian and the human owner. */
export function waiverEvidence(state: State, who: Actor, receiptId: unknown) {
  const receipt = record(state,receiptId,'acknowledgement');
  insist(who.role === 'owner' && who.isOwner || who.role === 'member' && (who.personId === receipt.personId || guardianOf(state,who.personId,receipt.personId)),'evidence_not_found',404);
  const document = record(state,receipt.waiverId,'waiver');
  return {format:'strap-waiver-evidence-v1',document:{id:document.id,version:document.version,text:document.text,sha256:document.documentHash ?? null,...(document.service ? {service:document.service} : {}),...(document.validDays ? {validDays:document.validDays} : {})},
    receipt:{id:receipt.id,personId:receipt.personId,actorId:receipt.actorId,at:receipt.createdAt,...(receipt.validUntil ? {validUntil:receipt.validUntil} : {}),signature:receipt.signature ?? null},
    meaning:receipt.signature ? receipt.signature.meaning : 'Receipt of an exact waiver version; not a signature or payment authorization.'};
}

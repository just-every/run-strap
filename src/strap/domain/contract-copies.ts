import { humanOwner, id, insist, instant, list, now, person, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';

const regions = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '));
export const contractRegion = (state: State, personId: string) => state.records.get(`contract-jurisdiction:${personId}`)?.data.region ?? null;
/** Minimal state on file for cancellation rules; no address is shared with a delegate. */
export function saveContractRegion(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); const member = person(tx.state,input.personId), region = text(input.region,'region',2).toUpperCase();
  insist(regions.has(region),'invalid_region');
  const saved = {id:`contract-jurisdiction:${member.id}`,personId:member.id,region,evidenceReference:text(input.evidenceReference,'evidenceReference',200),updatedBy:tx.who.id,updatedAt:now()};
  tx.put('contractJurisdiction',saved);return saved;
}
/** The complete native invoice contract retained at acceptance, excluding internal source facts. */
export async function contractCopy(state: State, terms: RecordData) {
  const pack = record(state,terms.packId,'pack');
  const document = {version:1,agreementId:terms.id,personId:terms.personId,memberName:person(state,terms.personId,false).name,
    consent:terms.acknowledgement?.text??terms.consent,acceptedAt:terms.acceptedAt??null,
    priceCents:terms.amountCents,intervalMonths:terms.intervalMonths,firstDueAt:terms.firstDueAt,timeZone:terms.timeZone,stopPath:terms.stopPath,
    paidTerm:{startAt:pack.termStartAt??pack.createdAt,endAt:pack.allowanceExpiresAt??pack.expiresAt,credits:terms.credits,entitlement:terms.entitlement,eligibleServices:terms.eligibleServices,guestTerms:terms.guestTerms},
    cancellation:'One-step reasonless renewal stop; access continues to the paid term end. Statutory death, disability, relocation and cooling-off rights apply. Unused allocated prepaid value is refund due, settled externally. No payment method debit is authorized. No commitment, notice or early-termination fee was accepted in this native agreement.'};
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(document)));
  return {document,digest:Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')};
}
/** Explicit evidence of actual delivery, never equating an outbound attempt with receipt. */
export async function recordContractDelivery(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const terms=record(tx.state,input.termsId,'recurringTerms');insist(terms.acceptedAt,'accepted_recurring_terms_required',409);
  const copy=await contractCopy(tx.state,terms);insist(input.digest===copy.digest,'contract_copy_changed',409);
  const deliveredAt=instant(input.deliveredAt,'deliveredAt');insist(deliveredAt<=now(),'delivery_must_be_past');
  const reference=text(input.evidenceReference,'evidenceReference',200),requestId=text(input.requestId,'requestId',100);
  const prior=list(tx.state,'contractDelivery').find(r=>r.createdBy===tx.who.id&&r.requestId===requestId);
  if(prior){insist(prior.termsId===terms.id&&prior.digest===copy.digest&&prior.deliveredAt===deliveredAt&&prior.evidenceReference===reference,'delivery_record_changed',409);return prior;}
  const delivery={id:id(),personId:terms.personId,termsId:terms.id,...copy,deliveredAt,evidenceReference:reference,requestId,createdBy:tx.who.id,createdAt:now()};
  tx.put('contractDelivery',delivery);return delivery;
}
export const contractDeliveredAt = (state: State, termsId: string) => list(state,'contractDelivery').filter(r=>r.termsId===termsId).map(r=>r.deliveredAt).sort().at(0)??null;

import { localDate, localInstant } from '../zone';
import { contractRegion } from './contract-copies';
import { studioZone } from './pack-credits';
import { insist, text, type RecordData, type State } from './types';

function date(value: unknown, field: string) {
  const result = text(value,field,10), instant = Date.parse(result+'T00:00:00Z');
  insist(/^\d{4}-\d\d-\d\d$/.test(result) && Number.isFinite(instant) && new Date(instant).toISOString().slice(0,10) === result,`invalid_${field}`);
  return result;
}
const optionalDate = (value: unknown, field: string) => value === undefined || value === null || value === '' ? null : date(value,field);

/** Product rule from the 22 October ruling; this state table is not counsel-verified. */
export function guardianDateFacts(state: State, personId: string, input: Record<string,unknown>) {
  const majorityRegion: string | null = contractRegion(state,personId);
  const majorityAge = majorityRegion === 'MS' ? 21 : ['AL','NE'].includes(majorityRegion ?? '') ? 19 : 18;
  const timeZone = studioZone(state), birthOn = optionalDate(input.birthOn,'birthOn');
  let adultOn = optionalDate(input.adultOn,'adultOn');
  if (birthOn) {
    insist(birthOn <= localDate(new Date(),timeZone),'invalid_birthOn');
    const anniversary = new Date(birthOn+'T00:00:00Z');
    anniversary.setUTCFullYear(anniversary.getUTCFullYear()+majorityAge);
    const derived = anniversary.toISOString().slice(0,10);
    insist(!adultOn || adultOn === derived,'adultOn_mismatch');
    adultOn = derived;
  }
  insist(adultOn,'invalid_adultOn');
  const emancipatedOn = optionalDate(input.emancipatedOn,'emancipatedOn');
  const emancipationEvidenceReference = input.emancipationEvidenceReference === undefined || input.emancipationEvidenceReference === null || input.emancipationEvidenceReference === '' ? null : text(input.emancipationEvidenceReference,'emancipationEvidenceReference',200);
  insist(!!emancipatedOn === !!emancipationEvidenceReference,'emancipation_evidence_required');
  insist(!emancipatedOn || !birthOn || emancipatedOn >= birthOn,'invalid_emancipatedOn');
  const adultAt = new Date(localInstant(adultOn,'00:00',timeZone)).toISOString();
  const emancipatedAt = emancipatedOn ? new Date(localInstant(emancipatedOn,'00:00',timeZone)).toISOString() : null;
  const authorityEndsOn = emancipatedOn && emancipatedOn < adultOn ? emancipatedOn : adultOn;
  const authorityEndsAt = emancipatedAt && emancipatedAt < adultAt ? emancipatedAt : adultAt;
  return {birthOn,majorityRegion,majorityAge,majorityRuleVerified:false,majorityDateSource:birthOn?'birth-and-state':'verified-adult-date',adultOn,adultAt,emancipatedOn,emancipatedAt,emancipationEvidenceReference,authorityEndsOn,authorityEndsAt};
}

/** Existing verified adult dates remain valid when no birth facts were recorded. */
export function guardianAuthorityEndsAt(grant: RecordData): string | null {
  if (grant.kind !== 'minor-guardian') return null;
  if (!grant.adultAt) return null;
  return grant.emancipatedAt && grant.emancipatedAt < grant.adultAt ? grant.emancipatedAt : grant.adultAt;
}

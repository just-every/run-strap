import { insist, text, type RecordData, type State } from './types';

export const acceptancePresenceText = 'I confirm I am physically present at this studio while accepting this agreement.';

const openingContext = (state: State) => {
  const policy = state.records.get('cancellation-policy')?.data;
  return {studioOpenedOn:policy?.studioOpenedOn ?? null,
    ...(policy?.studioOpeningEvidenceReference ? {studioOpeningEvidenceReference:policy.studioOpeningEvidenceReference} : {})};
};

/** The sale location is separate from the authenticated member's acceptance door. */
export function proposalSaleContext(state: State, input: Record<string,unknown>) {
  const contractAcceptanceChannel = input.contractAcceptanceChannel ?? 'online';
  insist(contractAcceptanceChannel === 'online' || contractAcceptanceChannel === 'in-person','invalid_contractAcceptanceChannel');
  return {contractAcceptanceChannel,...openingContext(state),
    ...(contractAcceptanceChannel === 'in-person' ? {acceptanceEvidenceReference:text(input.acceptanceEvidenceReference,'acceptanceEvidenceReference',200)} : {})};
}

/** Old previews remain online; they did not obtain any narrower sale-location consent. */
export function saleContextCurrent(state: State, terms: RecordData) {
  if (terms.contractAcceptanceChannel === undefined) return true;
  const current = openingContext(state);
  return (terms.studioOpenedOn ?? null) === current.studioOpenedOn
    && (terms.studioOpeningEvidenceReference ?? null) === (current.studioOpeningEvidenceReference ?? null);
}

export function acceptedSaleContext(state: State, terms: RecordData, input: Record<string,unknown>) {
  const contractAcceptanceChannel = terms.contractAcceptanceChannel ?? 'online';
  insist(contractAcceptanceChannel === 'online' || contractAcceptanceChannel === 'in-person','invalid_contractAcceptanceChannel');
  insist(saleContextCurrent(state,terms),'preview_changed',409);
  const context = {contractAcceptanceChannel,...openingContext(state)};
  if (contractAcceptanceChannel === 'online') return context;
  insist(input.acceptancePresent === true || input.acceptancePresent === 'yes','acceptance_presence_confirmation_required');
  return {...context,acceptanceEvidenceReference:text(terms.acceptanceEvidenceReference,'acceptanceEvidenceReference',200),
    acceptancePresent:true,acceptancePresenceText};
}

export const previewSaleContext = (state: State, terms: RecordData) => !terms.acceptedAt && terms.contractAcceptanceChannel === undefined
  ? {contractAcceptanceChannel:'online',...openingContext(state)} : {};

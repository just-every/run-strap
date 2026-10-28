import { humanOwner, instant, insist, integer, list, now, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';

const kinds = ['leadCampaign','leadCampaignCost'] as const;

/** The actor and request identify one immutable observation across both commands. */
async function request(tx: Transaction, input: Record<string,unknown>, command: string, fields: string[]) {
  humanOwner(tx.who);
  insist(Object.keys(input).every(key => fields.includes(key)),'invalid_lead_campaign_input');
  const requestId = text(input.requestId,'requestId',100);
  const basis = JSON.stringify(Object.fromEntries(Object.keys(input).sort().map(key => [key,input[key]])));
  const prior = kinds.flatMap(kind => list(tx.state,kind)).find(row => row.createdBy === tx.who.id && row.requestId === requestId);
  if (prior) {
    insist(prior.command === command && prior.requestBasis === basis,'lead_campaign_request_changed',409);
    return {requestId,basis,key:prior.id,prior:structuredClone(prior)};
  }
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([tx.who.id,requestId])));
  const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return {requestId,basis,key,prior:null};
}

function append(tx: Transaction, kind: typeof kinds[number], saved: RecordData) {
  insist(!tx.state.records.has(saved.id),'lead_campaign_record_exists',409);
  // INSERT only: neither command can replace a campaign, cost or request identity.
  tx.state.records.set(saved.id,{kind,data:saved});
  tx.sql.push(tx.statement('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,?)',saved.id,kind,JSON.stringify(saved),tx.state.version+1));
  return structuredClone(saved);
}

/** Campaigns describe an intro acquisition period; creating one spends nothing. */
export async function createLeadCampaign(tx: Transaction, input: Record<string,unknown>) {
  const command = 'lead.campaign.create';
  const req = await request(tx,input,command,['requestId','name','introOfferId','startsAt','endsAt']);
  if (req.prior) return req.prior;
  const intro = record(tx.state,input.introOfferId,'introOffer');
  insist(intro.active === true,'intro_offer_closed',409);
  const startsAt = instant(input.startsAt,'startsAt'), endsAt = instant(input.endsAt,'endsAt');
  insist(startsAt < endsAt,'invalid_lead_campaign_period');
  return append(tx,'leadCampaign',{id:`lead-campaign:${req.key}`,name:text(input.name,'name',100),introOfferId:intro.id,
    startsAt,endsAt,createdAt:now(),createdBy:tx.who.id,command,requestId:req.requestId,requestBasis:req.basis});
}

/** Historical USD observations only: no payment, charge, message or ad purchase. */
export async function appendLeadCampaignCost(tx: Transaction, input: Record<string,unknown>) {
  const command = 'lead.campaign.cost';
  const req = await request(tx,input,command,['requestId','campaignId','amountCents','occurredAt','reference','note']);
  if (req.prior) return req.prior;
  const campaign = record(tx.state,input.campaignId,'leadCampaign');
  const occurredAt = instant(input.occurredAt,'occurredAt'), at = now();
  insist(occurredAt >= campaign.startsAt && occurredAt < campaign.endsAt,'lead_campaign_cost_outside_period',409);
  insist(occurredAt <= at,'lead_campaign_cost_not_occurred',409);
  const amountCents = integer(input.amountCents,'amountCents',1,100_000_000);
  const reference = text(input.reference,'reference',500);
  insist(!list(tx.state,'leadCampaignCost').some(cost => cost.campaignId === campaign.id && cost.reference === reference),'lead_campaign_cost_reference_used',409);
  const note = input.note === undefined || input.note === null || input.note === '' ? null : text(input.note,'note',4000);
  tx.reached(occurredAt);
  return append(tx,'leadCampaignCost',{id:`lead-campaign-cost:${req.key}`,campaignId:campaign.id,amountCents,currency:'USD',
    occurredAt,reference,note,createdAt:at,createdBy:tx.who.id,command,requestId:req.requestId,requestBasis:req.basis});
}

/** Optional attribution is accepted only while the campaign and intro are open.
 * A transactional caller must also fence its write with tx.future(endsAt). */
export function validateLeadCampaign(state: State, campaignId: unknown): RecordData | null {
  if (campaignId === undefined || campaignId === null || campaignId === '') return null;
  const campaign = record(state,campaignId,'leadCampaign'), at = now();
  insist(campaign.startsAt <= at && at < campaign.endsAt,'lead_campaign_not_active',409);
  const intro = record(state,campaign.introOfferId,'introOffer');
  insist(intro.active === true,'intro_offer_closed',409);
  return campaign;
}

/** The private campaign ledger has no member, staff, finance or agent view. */
export function leadCampaignSnapshot(state: State, who: Actor) {
  if (who.role !== 'owner' || !who.isOwner) return null;
  return {campaigns:structuredClone(list(state,'leadCampaign')),costs:structuredClone(list(state,'leadCampaignCost'))};
}

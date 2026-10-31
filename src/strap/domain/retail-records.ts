import { hasStaffRight, legacyStaffGrant, staffIdentity, staffLocationIds, staffMemberIds, updateLegacyStaffAccess } from './staff-rights';
import {
  humanOwner,
  person,
  type Actor,
  id,
  insist,
  list,
  now,
  text,
  type RecordData,
  type State,
} from "./types";
import type { Transaction } from "./store";

function retailBasis(input: Record<string,unknown>) {
  const canonical = (value: any): any =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, canonical(value[k])]),
          )
        : value;
  return JSON.stringify(canonical(input));
}

/** Authority is checked even when the original effect has already committed. */
export function priorRetailRequest(tx: Transaction, action: string, input: Record<string,unknown>) {
  requireRetail(tx,action,input);
  const requestId=text(input.requestId,'request_id',100),basis=retailBasis(input);
  const prior = list(tx.state, "retailAction").find(
    (a) =>
      a.actorId === tx.who.id &&
      a.action === action &&
      a.requestId === requestId,
  );
  if (prior) {
    insist(prior.basis === basis, "retail_request_changed", 409);
    return prior.result;
  }
  return null;
}

/** Durable actor-scoped requests survive portable exit and native restore. */
export function retailRequest(
  tx: Transaction,
  action: string,
  input: Record<string, unknown>,
  apply: () => RecordData,
) {
  const prior=priorRetailRequest(tx,action,input);
  if(prior)return prior;
  const requestId=text(input.requestId,'request_id',100),basis=retailBasis(input);
  const priorAdjustments = new Set(list(tx.state,'drawerAdjustment').map(row => row.id));
  const result = apply();
  const adjustment = list(tx.state,'drawerAdjustment').find(row => !priorAdjustments.has(row.id));
  tx.put("retailAction", {
    id: id(),
    actorId: tx.who.id,
    role: tx.who.role,
    action,
    requestId,
    basis,
    result,
    createdAt: now(),
    ...(adjustment ? {sourceKind:'drawerAdjustment',sourceId:adjustment.id} : {}),
  });
  return result;
}

export const ordered = (s: State, kind: string) =>
  list(s, kind).sort(
    (a, b) =>
      (a.createdAt ?? a.startAt ?? "").localeCompare(
        b.createdAt ?? b.startAt ?? "",
      ) || a.id.localeCompare(b.id),
  );

export const retailGrant = (s: State, who: Actor) => legacyStaffGrant(s,who,'retail');
export async function grantRetailStaff(tx: Transaction, input: Record<string, unknown>) {
  humanOwner(tx.who);
  const staff = await staffIdentity(tx,input.personId,'front-desk');
  for (const key of ['enabled','sale','refund']) insist(typeof input[key] === 'boolean','invalid_retail_grant');
  const memberIds = staffMemberIds(tx.state,input.memberIds), locationIds = staffLocationIds(tx.state,input.locationIds);
  return updateLegacyStaffAccess(tx,'retail',{id:'retail-staff:'+staff.id,personId:staff.id,enabled:input.enabled,sale:input.sale,refund:input.refund,memberIds,locationIds});
}

export function requireRetail(tx: Transaction, action: string, input: Record<string,unknown>) {
  if (tx.who.role === 'owner' && tx.who.isOwner) { humanOwner(tx.who); return; }
  insist(['manager','front-desk','finance'].includes(tx.who.role),'retail_right_required',403);
  const giftAction = ['sale','gift.issue','gift.adjust','gift.refund'].includes(action);
  insist(giftAction || action === 'return','retail_right_required',403);
  const right = action === 'sale' || action === 'gift.issue' ? 'sale' : 'refund';
  const card = input.giftCardId ? tx.state.records.get(String(input.giftCardId))?.data : null;
  const cardAction = action === 'gift.adjust' || action === 'gift.refund';
  const sale = action === 'return' ? tx.state.records.get(String(input.saleId)) : null;
  const memberId = cardAction ? card?.personId : action === 'return' ? sale?.kind === 'retailSale' ? sale.data.personId : undefined : input.personId;
  const locationId = cardAction ? card?.locationId : action === 'return' ? sale?.data.locationId : input.locationId ?? 'studio';
  const common = hasStaffRight(tx.state,tx.who,right,memberId,locationId);
  const legacy = giftAction && hasStaffRight(tx.state,tx.who,right,memberId,locationId,'retail');
  insist(common || legacy,'retail_right_required',403);
  insist(typeof memberId === 'string' && typeof locationId === 'string','retail_scope_required',403);
  const door = common ? 'all' : 'retail';
  if (action === 'sale' && !common) {
    insist(card && hasStaffRight(tx.state,tx.who,right,card.personId,card.locationId ?? locationId,door),'retail_scope_required',403);
    insist(input.tender === 'gift','gift_redemption_only',403);
  }
  if (action === 'gift.issue') insist(typeof input.recipientId === 'string' && hasStaffRight(tx.state,tx.who,right,input.recipientId,locationId,door),'retail_scope_required',403);
}

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

/** Durable actor-scoped requests survive portable exit and native restore. */
export function retailRequest(
  tx: Transaction,
  action: string,
  input: Record<string, unknown>,
  apply: () => RecordData,
) {
  requireRetail(tx, action, input);
  const requestId = text(input.requestId, "request_id", 100);
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
  const basis = JSON.stringify(canonical(input));
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
  const result = apply();
  tx.put("retailAction", {
    id: id(),
    actorId: tx.who.id,
    role: tx.who.role,
    action,
    requestId,
    basis,
    result,
    createdAt: now(),
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

export const retailGrant = (s: State, who: Actor) => s.records.get("retail-staff:" + who.personId)?.data;
export function grantRetailStaff(tx: Transaction, input: Record<string, unknown>) {
  humanOwner(tx.who);
  const staff = person(tx.state,input.personId);
  insist(staff.role === "member" && staff.email, "member_staff_identity_required");
  for (const key of ["enabled","sale","refund"]) insist(typeof input[key] === "boolean", "invalid_retail_grant");
  insist(Array.isArray(input.memberIds) && input.memberIds.length <= 500 && Array.isArray(input.locationIds) && input.locationIds.length <= 50, "invalid_retail_scope");
  const memberIds = [...new Set(input.memberIds.map(key => person(tx.state,key).id))];
  const locationIds = [...new Set(input.locationIds.map(String))];
  insist(locationIds.every(key => key === "studio" || tx.state.records.get(key)?.kind === "location"), "invalid_location");
  const id = "retail-staff:" + staff.id, before = tx.state.records.get(id)?.data ?? null;
  const saved = {id,personId:staff.id,enabled:input.enabled,sale:input.sale,refund:input.refund,memberIds,locationIds,updatedBy:tx.who.id,updatedAt:now()};
  tx.put("retailStaffGrant",saved);
  tx.put("retailStaffGrantEvent",{id:crypto.randomUUID(),before,after:saved,actorId:tx.who.id,createdAt:now()});
  return saved;
}

export function requireRetail(tx: Transaction, action: string, input: Record<string,unknown>) {
  if (tx.who.role === "front-desk") {
    const grant = retailGrant(tx.state, tx.who), right = action === "sale" || action === "gift.issue" ? "sale" : "refund";
    insist(["sale","gift.issue","gift.adjust","gift.refund"].includes(action) && grant?.enabled && grant[right], "retail_right_required", 403);
    const card = input.giftCardId ? tx.state.records.get(String(input.giftCardId))?.data : null;
    const cardAction = action === "gift.adjust" || action === "gift.refund";
    insist(grant.memberIds.includes(cardAction ? card?.personId : input.personId) && grant.locationIds.includes(cardAction ? card?.locationId : input.locationId ?? "studio"), "retail_scope_required", 403);
    if (action === "sale") insist(card && grant.memberIds.includes(card.personId), "retail_scope_required", 403);
    if (action === "gift.issue") insist(grant.memberIds.includes(input.recipientId), "retail_scope_required", 403);
    if (action === "sale") insist(input.tender === "gift", "gift_redemption_only", 403);
  } else humanOwner(tx.who);
}

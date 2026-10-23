import {
  humanOwner,
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
  humanOwner(tx.who);
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

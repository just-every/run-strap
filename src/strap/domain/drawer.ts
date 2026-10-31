import {
  id,
  integer,
  insist,
  list,
  now,
  record,
  text,
  type State,
  type RecordData,
} from "./types";
import type { Transaction } from "./store";
import { placeId } from "./locations";
import { localDate } from "../zone";
import { locations } from "./locations";
import { retailRequest, ordered } from "./retail-records";

export function drawerReport(s: State, session: any) {
  const entries = ordered(s, "drawerEntry").filter(
      (e) => e.sessionId === session.id,
    ),
    expectedCents =
      session.floatCents +
      entries
        .filter((e) => e.tender === "cash")
        .reduce((n, e) => n + e.amountCents, 0);
  return {
    ...session,
    entries,
    expectedCents,
    countedCents: session.countedCents ?? null,
    varianceCents:
      session.countedCents == null
        ? null
        : session.countedCents - expectedCents,
  };
}
export function postDrawerTender(
  tx: Transaction,
  key: unknown,
  locationId: string,
  tender: string,
  amountCents: number,
  sourceId: string,
  kind: string,
  reason = "",
) {
  if (!key) {
    insist(tender !== "cash", "open_drawer_required", 409);
    return null;
  }
  const session = record(tx.state, key, "drawerSession");
  insist(session.status === "open", "drawer_closed", 409);
  insist(session.locationId === locationId, "drawer_location_mismatch", 409);
  if (tender === "cash")
    insist(
      drawerReport(tx.state, session).expectedCents + amountCents >= 0,
      "insufficient_drawer_cash",
      409,
    );
  const saved = {
    id: id(),
    sessionId: session.id,
    locationId,
    tender,
    amountCents,
    sourceId,
    kind,
    reason,
    actorId: tx.who.id,
    createdAt: now(),
  };
  tx.put("drawerEntry", saved);
  return saved;
}
export function openDrawer(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "drawer.open", input, () => {
    const locationId = placeId(tx.state, input.locationId),
      register = text(input.register, "register", 80);
    insist(
      !list(tx.state, "drawerSession").some(
        (s) =>
          s.locationId === locationId &&
          s.register === register &&
          s.status === "open",
      ),
      "register_already_open",
      409,
    );
    const saved = {
      id: id(),
      locationId,
      register,
      floatCents: integer(input.floatCents, "float", 0, 100_000_000),
      status: "open",
      version: 1,
      openedBy: tx.who.id,
      createdAt: now(),
    };
    tx.put("drawerSession", saved);
    return saved;
  });
}
export function drawerCash(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "drawer.cash", input, () => {
    insist(
      ["paid_in", "paid_out"].includes(String(input.kind)),
      "invalid_cash_movement",
    );
    const reason = text(input.reason, "cash_reason", 500),
      amount = integer(input.amountCents, "cash_amount", 1, 100_000_000),
      session = record(tx.state, input.sessionId, "drawerSession");
    return postDrawerTender(
      tx,
      session.id,
      session.locationId,
      "cash",
      input.kind === "paid_out" ? -amount : amount,
      id(),
      String(input.kind),
      reason,
    )!;
  });
}
const denominations = [
  1, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
];
export function closeDrawer(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "drawer.close", input, () => {
    const session = record(tx.state, input.sessionId, "drawerSession");
    insist(session.status === "open", "drawer_closed", 409);
    insist(
      Array.isArray(input.denominations) &&
        input.denominations.length > 0 &&
        input.denominations.length <= denominations.length,
      "denomination_count_required",
    );
    const counts = input.denominations.map((r: any) => {
      insist(r && denominations.includes(r.cents), "invalid_denomination");
      return {
        cents: r.cents,
        count: integer(r.count, "denomination_count", 0, 1_000_000),
      };
    });
    insist(
      new Set(counts.map((r) => r.cents)).size === counts.length,
      "duplicate_denomination",
    );
    const countedCents = integer(
        counts.reduce((n, r) => n + r.cents * r.count, 0),
        "counted_cash",
        0,
        100_000_000,
      ),
      expectedCents = drawerReport(tx.state, session).expectedCents;
    const reason =
      countedCents === expectedCents
        ? String(input.reason ?? "")
        : text(input.reason, "variance_reason", 500);
    const saved = {
      ...session,
      status: "closed",
      version: (session.version ?? 0) + 1,
      countedCents,
      denominations: counts,
      closeReason: reason,
      closedAt: now(),
      closedBy: tx.who.id,
    };
    tx.put("drawerSession", saved);
    return drawerReport(tx.state, saved);
  });
}
export function adjustDrawer(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "drawer.adjust", input, () => {
    const session = record(tx.state, input.sessionId, "drawerSession");
    insist(session.status === "closed", "closed_drawer_required", 409);
    const reason = text(input.reason, "manager_adjustment_reason", 500),
      countedCents = integer(
        input.countedCents,
        "corrected_count",
        0,
        100_000_000,
      );
    const change = {
      id: id(),
      sessionId: session.id,
      before: session.countedCents,
      after: countedCents,
      reason,
      actorId: tx.who.id,
      actorRole: tx.who.role,
      version: (session.version ?? 0) + 1,
      locationId: session.locationId,
      createdAt: now(),
    };
    tx.put("drawerAdjustment", change);
    tx.put("drawerSession", { ...session, countedCents, version: change.version });
    return change;
  });
}
export function reopenDrawer(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "drawer.reopen", input, () => {
    const session = record(tx.state, input.sessionId, "drawerSession"),
      reason = text(input.reason, "manager_reopen_reason", 500);
    insist(session.status === "closed", "closed_drawer_required", 409);
    insist(
      !list(tx.state, "drawerSession").some(
        (s) =>
          s.locationId === session.locationId &&
          s.register === session.register &&
          s.id !== session.id &&
          (s.status === "open" || s.createdAt >= session.createdAt),
      ),
      "later_drawer_exists",
      409,
    );
    const at = now();
    const saved = {
      ...session,
      status: "open",
      countedCents: null,
      version: (session.version ?? 0) + 1,
      reopenedAt: at,
      reopenedBy: tx.who.id,
    };
    tx.put("drawerAdjustment", {
      id: id(),
      sessionId: session.id,
      before: session,
      after: saved,
      reason,
      action: "reopen",
      actorId: tx.who.id,
      actorRole: tx.who.role,
      version: saved.version,
      locationId: session.locationId,
      createdAt: at,
    });
    tx.put("drawerSession", saved);
    return saved;
  });
}
export function tenderDay(s: State, date: string) {
  insist(
    /^\d{4}-\d\d-\d\d$/.test(date) &&
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date,
    "invalid_tender_date",
  );
  const places = locations(s),
    all: RecordData[] = [
      ...list(s, "retailSale").map((r) => ({ ...r, kind: "sale" })),
      ...list(s, "giftFundingRefund").map((r) => ({
        ...r,
        amountCents: -r.amountCents,
        kind: "gift_refund",
      })),
      ...list(s, "giftCard").map((r) => ({ ...r, kind: "gift_issue" })),
      ...list(s, "retailReturn").map((r) => ({
        ...r,
        amountCents: -r.amountCents,
        kind: "refund",
      })),
    ];
  const sources = all.filter(
    (r) =>
      localDate(
        r.createdAt,
        places.find((l) => l.id === r.locationId)?.timeZone ?? "UTC",
      ) === date,
  );
  return {
    date,
    sources,
    totals: ["cash", "external", "gift"].map((tender) => ({
      tender,
      amountCents: sources
        .filter((r) => r.tender === tender)
        .reduce((n, r) => n + r.amountCents, 0),
    })),
  };
}
export function drawerSnapshot(s: State) {
  return {
    sessions: ordered(s, "drawerSession").map((r) => drawerReport(s, r)),
    adjustments: ordered(s, "drawerAdjustment"),
  };
}

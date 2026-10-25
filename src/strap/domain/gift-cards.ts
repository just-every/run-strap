import {
  id,
  instant,
  integer,
  insist,
  list,
  now,
  person,
  record,
  text,
  type State,
} from "./types";
import type { Transaction } from "./store";
import { placeId } from "./locations";
import { postDrawerTender } from "./drawer";
import { retailRequest, ordered } from "./retail-records";
export const giftBalance = (s: State, key: string): number =>
  ordered(s, "giftEntry")
    .filter((e) => e.giftCardId === key)
    .reduce((n, e) => n + e.amountCents, 0);
export function issueGift(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "gift.issue", input, () => {
    const purchaser = person(tx.state, input.personId),
      recipient = person(tx.state, input.recipientId),
      amountCents = integer(input.amountCents, "gift_value", 1, 100_000_000),
      locationId = placeId(tx.state, input.locationId),
      tender = text(input.tender, "tender", 20),
      reference = text(input.reference, "funding_reference", 160);
    insist(["cash", "external"].includes(tender), "external_or_cash_only");
    insist(
      !list(tx.state, "payment").some((p) => p.reference === reference),
      "payment_reference_used",
      409,
    );
    const saved = {
      id: id(),
      personId: recipient.id,
      purchaserId: purchaser.id,
      amountCents,
      locationId,
      tender,
      reference,
      chargeId: id(),
      paymentId: id(),
      createdAt: now(),
      actorId: tx.who.id,
    };
    postDrawerTender(
      tx,
      input.sessionId,
      locationId,
      tender,
      amountCents,
      saved.id,
      "gift_issue",
    );
    tx.put("giftCard", saved);
    tx.put("giftEntry", {
      id: id(),
      giftCardId: saved.id,
      amountCents,
      kind: "issue",
      sourceId: saved.id,
      actorId: tx.who.id,
      createdAt: saved.createdAt,
    });
    tx.put("charge", {
      id: saved.chargeId,
      personId: purchaser.id,
      locationId,
      giftCardId: saved.id,
      amountCents,
      reason: "gift_card_issue",
      createdAt: saved.createdAt,
    });
    tx.put("payment", {
      id: saved.paymentId,
      personId: purchaser.id,
      locationId,
      giftCardId: saved.id,
      chargeId: saved.chargeId,
      amountCents,
      tender,
      reference,
      recordedBy: tx.who.id,
      createdAt: saved.createdAt,
    });
    return saved;
  });
}
export function savePromotion(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "promotion", input, () => {
    const code = text(input.code, "promotion_code", 60).toUpperCase();
    insist(
      !list(tx.state, "promotion").some((p) => p.code === code),
      "promotion_code_used",
      409,
    );
    const startsAt = instant(input.startsAt, "starts_at"),
      endsAt = instant(input.endsAt, "ends_at");
    insist(startsAt < endsAt, "invalid_promotion_dates");
    insist(typeof input.stackable === "boolean", "choose_stacking_rule");
    const saved = {
      id: id(),
      code,
      startsAt,
      endsAt,
      amountCents: integer(input.amountCents, "discount_cents", 1, 100_000_000),
      maxUses: integer(input.maxUses, "max_uses"),
      perMember: integer(input.perMember, "per_member_uses"),
      stackable: input.stackable,
      skuId: input.skuId ? record(tx.state, input.skuId, "sku").id : null,
      createdAt: now(),
      actorId: tx.who.id,
    };
    tx.put("promotion", saved);
    return saved;
  });
}
export function promotionPrice(
  tx: Transaction,
  input: Record<string, unknown>,
  sku: any,
  personId: string,
  grossCents: number,
) {
  const codes = input.promoCodes ?? [];
  insist(Array.isArray(codes) && codes.length <= 10, "invalid_promotion_codes");
  let amountCents = grossCents;
  const promotions = codes.map((c) => {
    const p = list(tx.state, "promotion").find(
      (p) => p.code === text(c, "promotion_code", 60).toUpperCase(),
    );
    insist(p, "promotion_not_found", 404);
    return p;
  });
  insist(
    new Set(promotions.map((p) => p.id)).size === promotions.length,
    "duplicate_promotion",
  );
  insist(
    promotions.length <= 1 || promotions.every((p) => p.stackable),
    "promotions_do_not_stack",
    409,
  );
  for (const p of promotions) {
    const at = now(),
      uses = list(tx.state, "promotionUse").filter(
        (u) => u.promotionId === p.id,
      );
    insist(at >= p.startsAt && at < p.endsAt, "promotion_outside_dates", 409);
    tx.reached(p.startsAt);
    tx.future(p.endsAt);
    insist(!p.skuId || p.skuId === sku.id, "promotion_not_eligible", 409);
    insist(
      uses.length < p.maxUses &&
        uses.filter((u) => u.personId === personId).length < p.perMember,
      "promotion_use_limit",
      409,
    );
    amountCents = Math.max(0, amountCents - p.amountCents);
  }
  insist(amountCents > 0, "promotion_must_leave_positive_total");
  return { amountCents, discountCents: grossCents - amountCents, promotions };
}
export function spendGift(
  tx: Transaction,
  key: unknown,
  personId: string,
  amountCents: number,
  sourceId: string,
) {
  const card = record(tx.state, key, "giftCard");
  insist(card.personId === personId, "gift_card_not_found", 404);
  insist(
    giftBalance(tx.state, card.id) >= amountCents,
    "insufficient_gift_balance",
    409,
  );
  tx.put("giftEntry", {
    id: id(),
    giftCardId: card.id,
    amountCents: -amountCents,
    kind: "redeem",
    sourceId,
    actorId: tx.who.id,
    createdAt: now(),
  });
  return card.id;
}
export function restoreGift(
  tx: Transaction,
  key: string,
  amountCents: number,
  sourceId: string,
) {
  record(tx.state, key, "giftCard");
  tx.put("giftEntry", {
    id: id(),
    giftCardId: key,
    amountCents,
    kind: "return",
    sourceId,
    actorId: tx.who.id,
    createdAt: now(),
  });
}
export function adjustGift(tx: Transaction, input: Record<string, unknown>) {
  return retailRequest(tx, "gift.adjust", input, () => {
    const card = record(tx.state, input.giftCardId, "giftCard"),
      amountCents = integer(
        input.amountCents,
        "gift_adjustment",
        -100_000_000,
        100_000_000,
      ),
      reason = text(input.reason, "refund_right_reason", 500),
      before = giftBalance(tx.state, card.id);
    insist(
      amountCents !== 0 &&
        before + amountCents >= 0 &&
        before + amountCents <= 100_000_000,
      "invalid_gift_adjustment",
    );
    const saved = {
      id: id(),
      giftCardId: card.id,
      personId: card.personId,
      amountCents,
      before,
      after: before + amountCents,
      reason,
      kind: "adjust",
      sourceId: id(),
      actorId: tx.who.id,
      createdAt: now(),
    };
    tx.put("giftEntry", saved);
    return saved;
  });
}
export function giftSnapshot(s: State) {
  return {
    cards: ordered(s, "giftCard").map((c) => ({
      ...c,
      balanceCents: giftBalance(s, c.id),
    })),
    entries: ordered(s, "giftEntry"),
    promotions: ordered(s, "promotion"),
    uses: ordered(s, "promotionUse"),
    refunds: ordered(s, "giftFundingRefund"),
    liabilityCents: ordered(s, "giftEntry").reduce(
      (n, e) => n + e.amountCents,
      0,
    ),
  };
}
export function refundGiftFunding(
  tx: Transaction,
  input: Record<string, unknown>,
) {
  return retailRequest(tx, "gift.refund", input, () => {
    const card = record(tx.state, input.giftCardId, "giftCard"),
      amountCents = integer(input.amountCents, "gift_refund", 1, 100_000_000),
      reason = text(input.reason, "gift_refund_reason", 500),
      reference = text(input.reference, "refund_reference", 160);
    insist(
      giftBalance(tx.state, card.id) >= amountCents,
      "insufficient_gift_balance",
      409,
    );
    insist(
      list(tx.state, "giftFundingRefund")
        .filter((r) => r.giftCardId === card.id)
        .reduce((n, r) => n + r.amountCents, 0) +
        amountCents <=
        card.amountCents,
      "gift_funding_already_refunded",
      409,
    );
    insist(
      !list(tx.state, "payment").some((p) => p.reference === reference),
      "payment_reference_used",
      409,
    );
    const saved = {
      id: id(),
      giftCardId: card.id,
      personId: card.purchaserId,
      locationId: card.locationId,
      tender: card.tender,
      amountCents,
      reason,
      reference,
      chargeId: id(),
      paymentId: id(),
      actorId: tx.who.id,
      createdAt: now(),
    };
    postDrawerTender(
      tx,
      input.sessionId,
      card.locationId,
      card.tender,
      -amountCents,
      saved.id,
      "gift_refund",
    );
    tx.put("giftFundingRefund", saved);
    tx.put("giftEntry", {
      id: id(),
      giftCardId: card.id,
      amountCents: -amountCents,
      kind: "funding_refund",
      sourceId: saved.id,
      reason,
      actorId: tx.who.id,
      createdAt: saved.createdAt,
    });
    tx.put("charge", {
      id: saved.chargeId,
      personId: card.purchaserId,
      locationId: card.locationId,
      giftCardId: card.id,
      reversesChargeId: card.chargeId,
      amountCents: -amountCents,
      reason: "gift_card_issue",
      createdAt: saved.createdAt,
    });
    tx.put("payment", {
      id: saved.paymentId,
      personId: card.purchaserId,
      locationId: card.locationId,
      giftCardId: card.id,
      chargeId: saved.chargeId,
      amountCents: -amountCents,
      tender: card.tender,
      reference,
      recordedBy: tx.who.id,
      createdAt: saved.createdAt,
    });
    return saved;
  });
}

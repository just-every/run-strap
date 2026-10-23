import {
  body,
  cell,
  emptyLine,
  field,
  form,
  h,
  hidden,
  panel,
  personSelect,
  select,
  table,
} from "./shared";
import { localDate } from "../zone";
const breakable = (value: unknown) => {
  const chars = [...String(value ?? "")];
  let output = "";
  for (let i = 0; i < chars.length; i += 12)
    output += (i ? "<wbr>" : "") + h(chars.slice(i, i + 12).join(""));
  return output;
};
const path = "/app/retail",
  money = (n: number) => "$" + (n / 100).toFixed(2),
  whole = 'required min="0" step="1"',
  reason = () =>
    field("reason", "Reason", "", "text", 'required maxlength="500"');
const req = () => hidden("requestId", crypto.randomUUID());
const detail = (title: string, html: string) =>
  `<details class="more"><summary>${breakable(title)}</summary><div class="panel-body">${html}</div></details>`;
export function retailPage(s: any, query: URLSearchParams) {
  const r = s.retail ?? {
      skus: [],
      suppliers: [],
      stock: [],
      sales: [],
      returns: [],
      movements: [],
    },
    d = s.drawers ?? { sessions: [], adjustments: [] },
    places = (s.locations ?? []).map(
      (l: any) => [l.id, l.name] as [string, string],
    );
  const loc = () => select("locationId", "Location", places, "studio"),
    sku = () =>
      select(
        "skuId",
        "SKU variant",
        r.skus.map((v: any) => [
          v.id,
          v.sku + " · " + v.name + " · " + v.variant,
        ]),
      );
  const sessions = d.sessions.filter((x: any) => x.status === "open"),
    session = () =>
      select("sessionId", "Drawer session", [
        ["", "External tender without drawer"],
        ...sessions.map((v: any) => [
          v.id,
          v.register +
            " · " +
            (s.locations.find((l: any) => l.id === v.locationId)?.name ??
              v.locationId),
        ]),
      ]);
  const quantity = () =>
    field("quantity", "Quantity", 1, "number", 'required min="1" step="1"');
  const barcode = query.get("barcode")?.trim(),
    visibleStock = barcode
      ? r.stock.filter(
          (v: any) =>
            r.skus.find((x: any) => x.id === v.skuId)?.barcode === barcode,
        )
      : r.stock;
  const stocks = visibleStock
    .map((v: any) => {
      const item = r.skus.find((x: any) => x.id === v.skuId);
      return `<tr>${cell("SKU", breakable(item.sku))}${cell("Product", breakable(item.name + " · " + item.variant))}${cell("Barcode", breakable(item.barcode))}${cell("Location", breakable(s.locations.find((l: any) => l.id === v.locationId)?.name))}${cell("On hand", breakable(v.onHand) + (v.low ? " <strong>Low stock</strong>" : ""))}${cell("Unit price", breakable(money(item.priceCents)))}</tr>`;
    })
    .join("");
  const catalog = panel(
    "Stock by location",
    `<form class="form" method="get" action="/app/retail">${field("barcode", "Find barcode", barcode ?? "")}<button class="btn" type="submit">Look up barcode</button></form>` +
      (stocks
        ? table(
            ["SKU", "Product", "Barcode", "Location", "On hand", "Unit price"],
            stocks,
          )
        : emptyLine(
            barcode
              ? "No matching barcode."
              : "Add a supplier and two or more SKU variants to begin.",
          )),
  );
  const setup = panel(
    "Receiving and stock controls",
    body(
      detail(
        "Add supplier",
        form(
          "retail.supplier.add",
          path,
          req() +
            field("name", "Supplier name", "", "text", "required") +
            field("reference", "Supplier reference", "", "text", "required"),
          "Add supplier",
        ),
      ) +
        detail(
          "Add SKU variant",
          form(
            "retail.sku.add",
            path,
            req() +
              field("sku", "SKU", "", "text", "required") +
              field("name", "Product name", "", "text", "required") +
              field("variant", "Size or variant", "", "text", "required") +
              field("barcode", "Barcode", "", "text", "required") +
              select(
                "supplierId",
                "Supplier",
                r.suppliers.map((v: any) => [v.id, v.name]),
              ) +
              field(
                "price",
                "Unit price in USD",
                "",
                "number",
                'required min="0.01" step="0.01"',
              ) +
              field("lowStock", "Low stock threshold", 1, "number", whole),
            "Add variant",
          ),
        ) +
        detail(
          "Receive purchase",
          form(
            "retail.receive",
            path,
            req() +
              sku() +
              loc() +
              quantity() +
              field("reference", "Purchase reference", "", "text", "required"),
            "Receive stock",
          ),
        ) +
        detail(
          "Record stock count",
          form(
            "retail.count",
            path,
            req() +
              sku() +
              loc() +
              field("count", "Counted units", 0, "number", whole) +
              reason(),
            "Record count",
          ),
        ) +
        detail(
          "Transfer stock",
          form(
            "retail.transfer",
            path,
            req() +
              sku() +
              loc() +
              select("toLocationId", "Destination", places) +
              quantity() +
              reason(),
            "Transfer stock",
          ),
        ),
    ),
  );
  const sales = panel(
    "Desk sales and returns",
    body(
      "<p>Cash, gift cards or externally recorded payment. Gift redemption is noncash. The sale records stock, charge and receipt together. Enter the exact total shown by quantity and unit price; a changed price is refused. A cash refund uses an open drawer at the original sale location.</p>" +
        detail(
          "Sell retail",
          form(
            "retail.sell",
            path,
            req() +
              personSelect(s) +
              sku() +
              loc() +
              quantity() +
              field(
                "expected",
                "Confirm total in USD",
                "",
                "number",
                'required min="0.01" step="0.01"',
              ) +
              select("tender", "Tender", [
                ["external", "Externally recorded"],
                ["cash", "Cash"],
                ["gift", "Gift card"],
              ]) +
              session() +
              select(
                "giftCardId",
                "Gift card",
                (s.gifts?.cards ?? []).map((c: any) => [
                  c.id,
                  c.id + " · " + money(c.balanceCents),
                ]),
                "",
                "",
              ) +
              field("promoCodes", "Promotion codes (comma separated)") +
              field("reference", "Tender reference", "", "text", "required"),
            "Record sale",
          ),
        ) +
        detail(
          "Return retail",
          form(
            "retail.return",
            path,
            req() +
              select(
                "saleId",
                "Original sale",
                r.sales.map((v: any) => [
                  v.id,
                  v.name + " · " + v.variant + " · " + v.reference,
                ]),
              ) +
              quantity() +
              select("restock", "Restock treatment", [
                ["false", "Damaged: do not restock"],
                ["true", "Return to available stock"],
              ]) +
              session() +
              reason(),
            "Record return",
          ),
        ) +
        (r.sales.length
          ? table(
              ["Sale", "Tender", "Total", "Returns"],
              r.sales
                .map(
                  (v: any) =>
                    `<tr>${cell("Sale", breakable(v.name + " · " + v.variant) + "<small>" + breakable(v.reference) + "</small>")}${cell("Tender", breakable(v.tender))}${cell("Total", breakable(money(v.amountCents)))}${cell("Returns", breakable(r.returns.filter((x: any) => x.saleId === v.id).reduce((n: number, x: any) => n + x.quantity, 0)))}</tr>`,
                )
                .join(""),
            )
          : emptyLine("No retail receipts yet.")),
    ),
  );
  const drawerRows = d.sessions
    .map(
      (v: any) =>
        `<tr>${cell("Register", breakable(v.register) + "<small>" + breakable(v.status) + "</small>")}${cell("Float", breakable(money(v.floatCents)))}${cell("Expected", breakable(money(v.expectedCents)))}${cell("Counted", v.countedCents === null ? "Not counted" : breakable(money(v.countedCents)))}${cell("Over or short", v.varianceCents === null ? "Open" : breakable(money(v.varianceCents)) + "<small>" + breakable(v.closeReason) + "</small>")}${cell("Controls", v.status === "open" ? detail("Count and close", form("drawer.close", path, req() + hidden("sessionId", v.id) + [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1].map((c) => field("denom_" + c, money(c) + " count", 0, "number", whole)).join("") + reason(), "Close drawer")) : detail("Manager correction", form("drawer.adjust", path, req() + hidden("sessionId", v.id) + field("counted", "Corrected counted cash in USD", "", "number", 'required min="0" step="0.01"') + reason(), "Adjust count")) + detail("Manager reopen", form("drawer.reopen", path, req() + hidden("sessionId", v.id) + reason(), "Reopen drawer")))}</tr>`,
    )
    .join("");
  const date = localDate(new Date().toISOString(), s.studio?.timeZone ?? "UTC");
  const drawers = panel(
    "Cash drawers",
    body(
      "<p>The owner acts as manager until staff rights ship. Every session retains its opening float, tender sources, denomination count and reasoned manager corrections. Paid movements affect the drawer; only sales and refunds affect tender sales totals.</p>" +
        detail(
          "Open register",
          form(
            "drawer.open",
            path,
            req() +
              loc() +
              field("register", "Register name", "", "text", "required") +
              field(
                "float",
                "Counted opening float in USD",
                "150.00",
                "number",
                'required min="0" step="0.01"',
              ),
            "Open drawer",
          ),
        ) +
        detail(
          "Paid cash movement",
          form(
            "drawer.cash",
            path,
            req() +
              session() +
              select("kind", "Cash movement", [
                ["paid_in", "Paid in"],
                ["paid_out", "Paid out"],
              ]) +
              field(
                "amount",
                "Amount in USD",
                "",
                "number",
                'required min="0.01" step="0.01"',
              ) +
              reason(),
            "Record cash movement",
          ),
        ) +
        (drawerRows
          ? table(
              [
                "Register",
                "Float",
                "Expected",
                "Counted",
                "Over or short",
                "Controls",
              ],
              drawerRows,
            )
          : emptyLine("No drawer sessions.")) +
        `<form class="form" action="/api/strap/retail/day.csv" method="get">${field("date", "Tender report date", date, "date", "required")}<button class="btn" type="submit">Download tender CSV</button></form>`,
    ),
  );
  const gift = s.gifts ?? {
    cards: [],
    promotions: [],
    entries: [],
    liabilityCents: 0,
  };
  const gifts = panel(
    "Gift cards and promotions",
    body(
      "<p>Outstanding gift liability: <strong>" +
        breakable(money(gift.liabilityCents)) +
        "</strong>. Cards have no expiration or fees. Only the owner can issue, look up, redeem or adjust them. Returns restore the original gift value; no automatic cash payout occurs.</p>" +
        detail(
          "Issue gift card",
          form(
            "retail.gift.issue",
            path,
            req() +
              personSelect(s, "", "Purchaser") +
              select(
                "recipientId",
                "Gift recipient",
                (s.people ?? [])
                  .filter((p: any) => p.active && p.role === "member")
                  .map((p: any) => [p.id, p.name]),
              ) +
              loc() +
              field(
                "amount",
                "Gift value in USD",
                "",
                "number",
                'required min="0.01" step="0.01"',
              ) +
              select("tender", "Funding tender", [
                ["external", "Externally recorded"],
                ["cash", "Cash"],
              ]) +
              session() +
              field("reference", "Funding reference", "", "text", "required"),
            "Issue gift card",
          ),
        ) +
        detail(
          "Refund gift funding",
          form(
            "retail.gift.refund",
            path,
            req() +
              select(
                "giftCardId",
                "Original gift card",
                gift.cards.map((c: any) => [
                  c.id,
                  c.id + " · " + money(c.balanceCents),
                ]),
              ) +
              field(
                "amount",
                "Original-tender refund in USD",
                "",
                "number",
                'required min="0.01" step="0.01"',
              ) +
              session() +
              field("reference", "Refund reference", "", "text", "required") +
              reason(),
            "Record original-tender refund",
          ),
        ) +
        detail(
          "Add promotion",
          form(
            "retail.promotion.add",
            path,
            req() +
              field("code", "Promotion code", "", "text", "required") +
              field(
                "startsAt",
                "Starts at (UTC)",
                "",
                "datetime-local",
                "required",
              ) +
              field(
                "endsAt",
                "Ends at (UTC)",
                "",
                "datetime-local",
                "required",
              ) +
              field(
                "amount",
                "Discount in USD",
                "",
                "number",
                'required min="0.01" step="0.01"',
              ) +
              field(
                "maxUses",
                "Total use limit",
                1,
                "number",
                'required min="1" step="1"',
              ) +
              field(
                "perMember",
                "Uses per member",
                1,
                "number",
                'required min="1" step="1"',
              ) +
              select("stackable", "Stacking", [
                ["false", "Cannot combine"],
                ["true", "May combine with other combinable codes"],
              ]) +
              select("skuId", "Eligible variant", [
                ["", "All variants"],
                ...r.skus.map((v: any) => [v.id, v.sku]),
              ]),
            "Add promotion",
          ),
        ) +
        (gift.cards.length
          ? table(
              ["Card", "Remaining liability", "Controls"],
              gift.cards
                .map(
                  (c: any) =>
                    `<tr>${cell("Card", breakable(c.id))}${cell("Remaining liability", breakable(money(c.balanceCents)))}${cell("Controls", detail("Refund-right adjustment", form("retail.gift.adjust", path, req() + hidden("giftCardId", c.id) + field("adjustment", "Signed adjustment in USD", "", "text", "required") + reason(), "Adjust gift value")))}</tr>`,
                )
                .join(""),
            )
          : emptyLine("No gift cards issued.")) +
        table(
          ["Code", "Discount", "Dates", "Uses", "Stacking"],
          gift.promotions
            .map(
              (p: any) =>
                `<tr>${cell("Code", breakable(p.code))}${cell("Discount", breakable(money(p.amountCents)))}${cell("Dates", breakable(p.startsAt + " to " + p.endsAt))}${cell("Uses", breakable((gift.uses ?? []).filter((u: any) => u.promotionId === p.id).length + " of " + p.maxUses))}${cell("Stacking", p.stackable ? "May combine" : "Cannot combine")}</tr>`,
            )
            .join(""),
        ),
    ),
  );
  const cashTrail = panel(
    "Drawer sources and manager history",
    body(
      table(
        ["Register", "Tender", "Kind", "Amount", "Source", "Actor"],
        d.sessions
          .flatMap((v: any) =>
            v.entries.map(
              (e: any) =>
                `<tr>${cell("Register", breakable(v.register))}${cell("Tender", breakable(e.tender))}${cell("Kind", breakable(e.kind))}${cell("Amount", breakable(money(e.amountCents)))}${cell("Source", breakable(e.sourceId) + "<small>" + breakable(e.reason) + "</small>")}${cell("Actor", breakable(e.actorId))}</tr>`,
            ),
          )
          .join(""),
      ) +
        table(
          ["Before", "After", "Reason", "Actor"],
          d.adjustments
            .map(
              (a: any) =>
                `<tr>${cell("Before", breakable(typeof a.before === "number" ? money(a.before) : a.action))}${cell("After", breakable(a.after === undefined ? "Open" : money(a.after)))}${cell("Reason", breakable(a.reason))}${cell("Actor", breakable(a.actorId))}</tr>`,
            )
            .join(""),
        ),
    ),
  );
  const trail = panel(
    "Stock movement trail",
    r.movements.length
      ? table(
          ["Type", "SKU", "Change", "Before", "After", "Reason"],
          r.movements
            .map(
              (v: any) =>
                `<tr>${cell("Type", breakable(v.kind))}${cell("SKU", breakable(r.skus.find((x: any) => x.id === v.skuId)?.sku))}${cell("Change", breakable(v.quantity))}${cell("Before", breakable(v.before))}${cell("After", breakable(v.after))}${cell("Reason", breakable(v.reason))}</tr>`,
            )
            .join(""),
        )
      : emptyLine("No stock movements."),
  );
  return `<div class="page single"><div class="page-main"><div class="page-title"><h1>Inventory and drawers</h1><p>Receive, sell, transfer and reconcile studio retail.</p></div>${catalog}${setup}${sales}${gifts}${drawers}${cashTrail}${trail}</div></div>`;
}

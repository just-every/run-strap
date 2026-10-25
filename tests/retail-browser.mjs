import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { chromium } from "@playwright/test";

async function screens(h, name, act, cookie = h.owner) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-mock-keychain", "--password-store=basic"],
  });
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await context.route(h.origin + "/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (!path.includes("..") && /\.(css|svg|woff2|png|ico)$/.test(path))
          return route.fulfill({
            body: await readFile(join(process.cwd(), "public", path)),
            contentType: {
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".woff2": "font/woff2",
              ".png": "image/png",
              ".ico": "image/x-icon",
            }[extname(path)],
          });
        return route.continue();
      });
      const i = cookie.indexOf("=");
      await context.addCookies([
        {
          name: cookie.slice(0, i),
          value: cookie.slice(i + 1),
          url: h.origin,
        },
      ]);
      const page = await context.newPage();
      await page.goto(h.origin + "/app/retail");
      await page
        .getByRole("heading", { name: "Inventory and drawers", exact: true })
        .waitFor();
      await act(page, width);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        "screen fits viewport",
      );
      const tip=page.locator('.has-tooltip').first();
      if(await tip.count()) {
        await tip.focus();
        await tip.locator('[role="tooltip"]').waitFor({state:"visible"});
        await tip.evaluate(e=>e.blur());
        await tip.hover();
        await tip.locator('[role="tooltip"]').waitFor({state:"visible"});
      }
      const iconOnly = await page
        .locator("a,button,summary")
        .evaluateAll((els) =>
          els
            .filter((el) => el.querySelector("svg") && !el.textContent.trim())
            .map((el) => ({
              name: el.getAttribute("aria-label"),
              tooltip: !!el.querySelector('[role="tooltip"]'),
            })),
        );
      assert.ok(
        iconOnly.every((c) => c.name && c.tooltip),
        "every icon-only control has a named tooltip",
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: join(process.env.STRAP_PROOF_DIR, `${name}-${width}.png`),
        fullPage: true,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
export async function retailBrowser(h, { large }) {
  await screens(h, "SALE-003", async (page, width) => {
    await page.getByLabel("Find barcode", { exact: true }).fill(large.barcode);
    await page
      .getByRole("button", { name: "Look up barcode", exact: true })
      .click();
    assert.ok(
      await page.getByRole("cell", { name: large.sku, exact: true }).count(),
    );
    const receive = page.locator("details").filter({
      has: page
        .locator("summary")
        .getByText("Receive purchase", { exact: true }),
    });
    await receive.locator("summary").click();
    await receive
      .getByLabel("SKU variant", { exact: true })
      .selectOption(large.id);
    await receive
      .getByLabel("Location", { exact: true })
      .selectOption("studio");
    await receive.getByLabel("Quantity", { exact: true }).fill("1");
    await receive
      .getByLabel("Purchase reference", { exact: true })
      .fill("synthetic-strap-102" + width);
    await receive
      .getByRole("button", { name: "Receive stock", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Inventory and drawers", exact: true })
      .waitFor();
    assert.ok(
      (
        await h.send("/api/strap/retail", undefined, h.owner)
      ).value.receipts.some(
        (r) => r.reference === "synthetic-strap-102" + width,
      ),
    );
  });
}
export async function drawerBrowser(h, sessionId) {
  await screens(h, "SALE-004", async (page, width) => {
    const row = page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", { name: "Front desk", exact: false }),
      })
      .filter({ has: page.getByText("Manager correction", { exact: true }) });
    const correction = row
      .locator("details")
      .filter({ has: page.getByText("Manager correction", { exact: true }) });
    await correction.locator("summary").click();
    await correction
      .getByLabel("Corrected counted cash in USD", { exact: true })
      .fill("170.00");
    await correction
      .getByLabel("Reason", { exact: true })
      .fill("Confirmed cash tray count " + width);
    await correction
      .getByRole("button", { name: "Adjust count", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Inventory and drawers", exact: true })
      .waitFor();
    const r = (await h.send("/api/strap/retail", undefined, h.owner)).value;
    assert.ok(
      r.adjustments.some(
        (a) => a.reason === "Confirmed cash tray count " + width,
      ),
    );
    assert.equal(r.sessions.find((s) => s.id === sessionId).varianceCents, 0);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download tender CSV", exact: true })
      .click();
    const file = await download;
    assert.equal(file.suggestedFilename(), "tenders.csv");
  });
}
export async function giftBrowser(h, giftCardId, desk) {
  await screens(h, "SALE-001", async (page, width) => {
    await page
      .getByRole("heading", { name: "Gift cards and promotions", exact: true })
      .waitFor();
    const details = page.getByRole("row").filter({has:page.locator('input[name="giftCardId"][value="'+giftCardId+'"]')}).locator("details");
    await details.locator("summary").click();
    await details
      .getByLabel("Signed adjustment in USD", { exact: true })
      .fill("1.00");
    await details
      .getByLabel("Reason", { exact: true })
      .fill("Approved gift correction " + width);
    await details
      .getByRole("button", { name: "Adjust gift value", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Inventory and drawers", exact: true })
      .waitFor();
    const r = (await h.send("/api/strap/retail", undefined, h.owner)).value;
    assert.ok(
      r.gifts.entries.some(
        (e) => e.reason === "Approved gift correction " + width,
      ),
    );
    assert.ok(r.gifts.cards.some((c) => c.id === giftCardId));
  });
  await h.cmd("retail.receive",{skuId:desk.last.id,quantity:2,reference:"synthetic-strap-130",requestId:"browser-gift-stock"});
  await screens(h,"SALE-001-desk",async(page,width)=>{
    const gift=await h.cmd("retail.gift.issue",{personId:desk.member.id,recipientId:desk.member.id,amountCents:6000,tender:"external",reference:"synthetic-strap-131"+width,requestId:"browser-gift-"+width});
    await page.reload();
    const sale=page.locator("details").filter({has:page.getByText("Sell retail",{exact:true})});
    await sale.locator("summary").click();
    await sale.getByLabel("Member",{exact:true}).selectOption(desk.member.id);
    await sale.getByLabel("SKU variant",{exact:true}).selectOption(desk.last.id);
    await sale.getByLabel("Confirm total in USD",{exact:true}).fill("60.00");
    await sale.getByLabel("Gift card",{exact:true}).selectOption(gift.id);
    await sale.getByLabel("Tender reference",{exact:true}).fill("synthetic-strap-132"+width);
    assert.equal(await sale.locator("form").evaluate(f=>f.reportValidity()),true);
    await sale.getByRole("button",{name:"Record sale",exact:true}).click();
    await page.getByRole("heading",{name:"Inventory and drawers",exact:true}).waitFor();
    const saved=(await h.send("/api/strap/retail",undefined,h.owner)).value;
    assert.equal(saved.gifts.cards.find(c=>c.id===gift.id).balanceCents,0,await page.locator("body").innerText());
    assert.equal(saved.sales.filter(s=>s.reference==="synthetic-strap-132"+width).length,1);
    assert.equal(await page.getByRole("button",{name:"Adjust gift value",exact:true}).count(),0);
  },desk.cookie);
}

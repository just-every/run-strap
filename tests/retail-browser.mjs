import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { chromium } from "@playwright/test";

async function screens(h, name, act, cookie = h.owner) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.STRAP_CHROMIUM,
    args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"],
  });
  await mkdir((process.env.STRAP_PROOF_DIR ?? process.env.STRAP_RIGHTS_PROOF_DIR), { recursive: true });
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
        path: join((process.env.STRAP_PROOF_DIR ?? process.env.STRAP_RIGHTS_PROOF_DIR), `${name}-${width}.png`),
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

export async function staffRetailBrowser(h, {manager,desk,buyer,other,sku,west,ownerGift,foreignSales,splitScope}) {
  for(const staff of [manager,desk]) {
    await screens(h,'STAFF-001-'+staff.name,async(page,width)=>{
      const details=label=>page.locator('details').filter({has:page.locator('summary').getByText(label,{exact:true})});
      // Each flow asserts at phone width; desktop is the same populated screen proof.
      if(width===390) {
        const issue=details('Issue gift card');await issue.locator('summary').click();
        await issue.getByLabel('Purchaser',{exact:true}).selectOption(buyer.id);
        await issue.getByLabel('Gift recipient',{exact:true}).selectOption(buyer.id);
        await issue.getByLabel('Location',{exact:true}).selectOption(west.id);
        await issue.getByLabel('Gift value in USD',{exact:true}).fill('60.00');
        await issue.getByLabel('Funding reference',{exact:true}).fill('synthetic-strap-browser-gift-'+staff.name);
        await issue.getByRole('button',{name:'Issue gift card',exact:true}).click();
        const read=async()=>(await h.send('/api/strap/retail',undefined,h.owner)).value;
        const card=(await read()).gifts.cards.find(c=>c.reference==='synthetic-strap-browser-gift-'+staff.name);
        assert.ok(card,'staff form issues the named gift');
        const sale=details('Sell retail');await sale.locator('summary').click();
        await sale.getByLabel('Member',{exact:true}).selectOption(buyer.id);
        await sale.getByLabel('SKU variant',{exact:true}).selectOption(sku.id);
        await sale.getByLabel('Location',{exact:true}).selectOption(west.id);
        await sale.getByLabel('Confirm total in USD',{exact:true}).fill('20.00');
        await sale.getByLabel('Tender',{exact:true}).selectOption('gift');
        await sale.getByLabel('Gift card',{exact:true}).selectOption(card.id);
        await sale.getByLabel('Tender reference',{exact:true}).fill('synthetic-strap-browser-sale-'+staff.name);
        await sale.getByRole('button',{name:'Record sale',exact:true}).click();
        const saved=(await read()).sales.find(s=>s.reference==='synthetic-strap-browser-sale-'+staff.name);
        assert.ok(saved);assert.equal((await read()).gifts.cards.find(c=>c.id===card.id).balanceCents,4000);
        const ret=details('Return retail');await ret.locator('summary').click();
        await ret.getByLabel('Original sale',{exact:true}).selectOption(saved.id);
        await ret.getByLabel('Restock treatment',{exact:true}).selectOption('true');
        await ret.getByLabel('Reason',{exact:true}).fill('Returned unworn');
        await ret.getByRole('button',{name:'Record return',exact:true}).click();
        assert.equal((await read()).returns.find(r=>r.saleId===saved.id).tender,'gift');
        const adjustment=page.getByRole('row').filter({has:page.locator('input[name="giftCardId"][value="'+card.id+'"]')}).locator('details');
        await adjustment.locator('summary').click();
        await adjustment.getByLabel('Signed adjustment in USD',{exact:true}).fill('1.00');
        await adjustment.getByLabel('Reason',{exact:true}).fill('Reviewed correction');
        await adjustment.getByRole('button',{name:'Adjust gift value',exact:true}).click();
        const refund=details('Refund gift funding');await refund.locator('summary').click();
        await refund.getByLabel('Original gift card',{exact:true}).selectOption(card.id);
        await refund.getByLabel('Original-tender refund in USD',{exact:true}).fill('10.00');
        await refund.getByLabel('Refund reference',{exact:true}).fill('synthetic-strap-browser-refund-'+staff.name);
        await refund.getByLabel('Reason',{exact:true}).fill('Original external funding returned');
        await refund.getByRole('button',{name:'Record original-tender refund',exact:true}).click();
        assert.equal((await read()).gifts.cards.find(c=>c.id===card.id).balanceCents,5100);
        assert.ok((await read()).gifts.refunds.some(r=>r.giftCardId===card.id&&r.tender==='external'&&r.amountCents===1000));
        for(const label of ['Receiving and stock controls','Cash drawers','Drawer sources and manager history'])assert.equal(await page.getByRole('heading',{name:label,exact:true}).count(),0);
        await splitScope(staff);
        await page.reload();
        const values=locator=>locator.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
        const scopedSale=details('Sell retail'),scopedIssue=details('Issue gift card'),scopedReturn=details('Return retail');
        assert.deepEqual(await values(scopedSale.getByLabel('Member',{exact:true})),[buyer.id],'sale form excludes refund-only members');
        assert.deepEqual(await values(scopedSale.getByLabel('Location',{exact:true})),['studio'],'sale form excludes refund-only locations');
        assert.deepEqual(await values(scopedIssue.getByLabel('Purchaser',{exact:true})),[buyer.id]);
        assert.deepEqual(await values(scopedIssue.getByLabel('Gift recipient',{exact:true})),[buyer.id]);
        assert.deepEqual(await values(scopedIssue.getByLabel('Location',{exact:true})),['studio']);
        const returnOptions=await values(scopedReturn.getByLabel('Original sale',{exact:true}));
        assert.ok(returnOptions.includes(foreignSales[west.id].id),'refund form includes separately authorized originals');
        assert.ok(!returnOptions.includes(saved.id),'refund form excludes sale-only originals');
        const redeemOptions=await values(scopedSale.getByLabel('Gift card',{exact:true}));
        assert.ok(!redeemOptions.includes(ownerGift.id),'redemption excludes refund-only gift cards');
        await scopedReturn.locator('summary').click();
        await scopedSale.locator('summary').click();
        await scopedIssue.locator('summary').click();
      }
      for(const label of ['Sell retail','Issue gift card','Refund gift funding'])await details(label).evaluate(e=>e.open=true);
    },staff.cookie);
  }
}

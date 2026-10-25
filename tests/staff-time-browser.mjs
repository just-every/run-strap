import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { chromium } from "@playwright/test";
export async function staffTimeBrowser(h, coach, manager) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-mock-keychain", "--password-store=basic"],
  });
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true });
  try {
    for (const width of [1440, 390])
      for (const [role, cookie] of [
        ["owner", h.owner],
        ["instructor", coach.cookie],
        ["manager", manager.cookie],
      ]) {
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
        await page.goto(h.origin + "/app/time-clock");
        await page
          .getByRole("heading", { name: "Time clock", exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (role === "owner") {
          const download = page.waitForEvent("download");
          await page
            .getByRole("link", {
              name: "Download approved hours CSV",
              exact: true,
            })
            .click();
          assert.equal(
            (await download).suggestedFilename(),
            "approved-hours.csv",
          );
        } else if (role === "instructor") {
          assert.equal(
            await page
              .getByRole("button", { name: "Approve hours", exact: true })
              .count(),
            0,
          );
          assert.equal(
            await page
              .getByRole("link", {
                name: "Download approved hours CSV",
                exact: true,
              })
              .count(),
            0,
          );
          await page
            .getByLabel("Job", { exact: true })
            .fill("Reception " + width);
          await page
            .getByRole("button", { name: "Clock in", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Time clock", exact: true })
            .waitFor();
          const shift = (
            await h.send("/api/strap/time-clock", undefined, coach.cookie)
          ).value.shifts.find((r) => r.job === "Reception " + width);
          assert.ok(shift);
          const row = page
            .getByRole("row")
            .filter({ hasText: "Reception " + width });
          await row
            .getByRole("button", { name: "Clock out", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Time clock", exact: true })
            .waitFor();
        }
        if (role === "manager") {
          const row=page.getByRole("row").filter({hasText:"Reception " + width});
          await row.getByRole("button",{name:"Approve hours",exact:true}).click();
          await page.getByRole("heading",{name:"Time clock",exact:true}).waitFor();
          const saved=(await h.send("/api/strap/time-clock",undefined,manager.cookie)).value.shifts.find(r=>r.job==="Reception "+width);
          assert.equal(saved.status,"approved");
        }
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
              .filter((e) => e.querySelector("svg") && !e.textContent.trim())
              .map((e) => !!e.querySelector('[role="tooltip"]')),
          );
        assert.ok(iconOnly.every(Boolean));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: join(
            process.env.STRAP_PROOF_DIR,
            `STAFF-003-${role}-${width}.png`,
          ),
          fullPage: true,
        });
        if (role === "owner") {
          await page.goto(h.origin + "/app/security");
          const rights=page.locator('form').filter({has:page.getByRole('button',{name:'Save approval right',exact:true})});
          await rights.getByLabel('Approval manager',{exact:true}).selectOption(manager.id);
          await rights.getByLabel('Time approval right',{exact:true}).selectOption('true');
          await rights.getByRole('button',{name:'Save approval right',exact:true}).click();
          await page.getByRole('heading',{name:'Security',exact:true}).waitFor();
          assert.equal(await page.locator('.notice.error[role="alert"]').count(),0,await page.locator("body").innerText());
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          const tip=page.locator('.has-tooltip').first();
          if(await tip.count()){await tip.focus();await tip.locator('[role="tooltip"]').waitFor({state:'visible'});}
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-003-security-${width}.png`),fullPage:true});
        }
        await context.close();
      }
  } finally {
    await browser.close();
  }
}

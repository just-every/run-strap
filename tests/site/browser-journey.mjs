import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
import { harness } from '../harness.mjs'

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }
async function file(path) {
  for (const candidate of [path, path + '.html', join(path, 'index.html')]) {
    try { return { body: await readFile(candidate), contentType: types[extname(candidate)] ?? 'application/octet-stream' } } catch {}
  }
  return null
}

export async function publicDoors(site) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://site').pathname)
    const asset = !path.includes('..') && await file(join(site, path))
    res.writeHead(asset ? 200 : 404, { 'content-type': asset?.contentType ?? 'text/plain' })
    res.end(asset?.body ?? 'Not found')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const siteOrigin = `http://127.0.0.1:${server.address().port}`
  const h = await harness()
  let browser
  try {
    await h.mf.ready
    browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } })
      const page = await context.newPage()
      const shot = async name => { if (process.env.STRAP_PROOF_DIR) { await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `${name}-${width}.png`), fullPage: true }) } }
      assert.equal((await page.goto(siteOrigin)).status(), 200)
      await shot('homepage')
      await page.locator('a.btn[href="/run"]').first().click()
      assert.equal(new URL(page.url()).pathname, '/run')
      assert.ok(await page.locator('main').innerText())
      await shot('run')
      assert.equal((await page.goto(siteOrigin + '/docs')).status(), 200)
      await shot('docs')
      const docs = await page.locator('a[href^="/docs/"]').evaluateAll(links => [...new Set(links.map(a => a.getAttribute('href')))])
      assert.ok(docs.length > 0, 'owner guides are linked from /docs')
      for (const path of docs) {
        assert.equal((await page.goto(siteOrigin + path)).status(), 200, path)
        assert.ok(await page.locator('h1').innerText(), path + ' has a rendered guide')
      }
      for (const path of ['/app', '/setup', '/signin']) assert.equal((await context.request.get(siteOrigin + path)).status(), 404, 'site excludes installed ' + path)
      // The installed Worker uses its real native invitations/session and D1.
      // Static assets are the same public files used by the production build.
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        const asset = !path.includes('..') && await file(join(process.cwd(), 'public', path))
        if (asset) return route.fulfill(asset)
        return route.continue()
      })
      assert.equal((await page.goto(h.origin)).status(), 200)
      assert.ok(await page.getByRole('link', { name: 'Sign in', exact: true }).isVisible())
      await shot('lobby')
      await page.goto(h.origin + '/app')
      await shot('signin')
      assert.equal(new URL(page.url()).pathname, '/signin', 'private app redirects signed-out visitors')
      const cookie = width === 1440 ? h.owner : await h.signIn(h.auth.OWNER_EMAIL)
      const split = cookie.indexOf('=')
      await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: h.origin }])
      await page.goto(h.origin + '/app')
      if (new URL(page.url()).pathname === '/setup') {
        await shot('setup')
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
      }
      assert.equal(new URL(page.url()).pathname, '/app')
      assert.ok(await page.locator('h1').innerText(), 'signed-in owner reaches the studio')
      await shot('app')
      assert.equal((await context.request.get(h.origin + '/run')).status(), 404, 'installed Worker excludes run site')
      assert.equal((await context.request.get(h.origin + '/docs')).status(), 404, 'installed Worker excludes public guides')
      await context.close()
    }
  } finally {
    await browser?.close()
    await h.close()
    await new Promise(resolve => server.close(resolve))
  }
}

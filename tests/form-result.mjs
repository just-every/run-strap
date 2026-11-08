import assert from 'node:assert/strict'

// Follow the private result redirect with this test browser's native session.
export async function formResult(h, response, cookie = h.owner) {
  if (response.status !== 303) return response
  assert.ok(response.headers.get('location')?.startsWith('/app'))
  const flash = response.headers.get('set-cookie')?.split(';')[0]
  return h.mf.dispatchFetch(new URL(response.headers.get('location'), h.origin).href, {
    headers: { origin: h.origin, cookie: [cookie, flash].filter(Boolean).join('; ') }, redirect: 'manual',
  })
}

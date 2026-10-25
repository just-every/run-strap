// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the
// deployed main stays src/server.ts, and `rer build` refuses any output that
// contains the dev layer. It adds dev sign-in, personas and the Dev title and name suffix.
import worker from './server'
import { withDevIdentity } from './modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from './auth.server'
import { devPersonas } from './dev-personas'
import { withDevAi } from './modules/ai/dev/index.mjs'
import { fontLinks } from './base/font-head'

const development = withDevAi<Bindings, typeof worker>(worker, { bindings: runtimeBindings })
const dev = withDevIdentity<Bindings, typeof worker>(development, { bindings: runtimeBindings, config: authConfig, personas: devPersonas })

// The dev layer answers its one-click sign-in, its hand-off page and its sign-in refusal itself, linking only the
// theme; they get the rest of Strap's tokens and rules (/fonts/fonts.css) after their own style, once, as the
// deployed sign-in pages get them from fontDocumentResponse. Only that sheet: the font head's components
// (/brand/strap.css) have never styled these pages.
const look = fontLinks.find(link => link.rel === 'stylesheet')!.href
export default {
  ...dev,
  async fetch(request, env, execution) {
    const response = await dev.fetch!(request, env, execution)
    if (!['/signin', '/__dev/key', '/auth/dev/enter'].includes(new URL(request.url).pathname) || !response.body || !response.headers.get('content-type')?.startsWith('text/html')) return response
    const html = await response.text(), headers = new Headers(response.headers)
    headers.delete('content-length')
    return new Response(html.includes(look) ? html : html.replace(/<\/head\s*>/i, `<link rel="stylesheet" href="${look}"></head>`), {
      status: response.status, statusText: response.statusText, headers,
    })
  },
} satisfies ExportedHandler<Bindings>

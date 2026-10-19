import type { Bindings } from '../../auth.server'
import { kioskCommand, kioskRead, DomainError } from '../domain'
import { kioskCookie, kioskOf, pairKiosk, pairingOpen } from './devices'
import { kioskDone, kioskHome, kioskMessage, kioskPairPage, kioskResults, kioskUnpaired } from '../ui/kiosk'

// The kiosk's only door (/kiosk). Its device cookie is never a session: /app and
// /api refuse it, and nothing here reads or changes anything but check-in.
const refusals: Record<string, string> = {
  no_booking_found: 'No booking found. Check the spelling, or ask at the front desk.',
  already_checked_in: 'You’re already checked in for this class.',
  checkin_window_closed: 'Check-in for this class is not open. It opens an hour before class.',
}

export async function kioskResponse(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url), path = url.pathname
  if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) return kioskUnpaired(403)
  if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405 })
  if (request.method === 'POST' && (request.headers.get('origin') !== env.AUTH_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site')) return kioskUnpaired(403)
  const form = request.method === 'POST' ? Object.fromEntries(new URLSearchParams((await request.text()).slice(0, 4000))) : {}
  if (path === '/kiosk/pair') {
    if (request.method === 'GET') return await pairingOpen(env, url.searchParams.get('token') ?? '') ? kioskPairPage(url.searchParams.get('token')!) : kioskUnpaired(410)
    const paired = await pairKiosk(env, String(form.token ?? ''))
    if (!paired) return kioskUnpaired(410)
    const secure = url.protocol === 'https:' ? '; Secure' : ''
    return new Response(null, { status: 303, headers: { location: '/kiosk', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin', 'set-cookie': `${kioskCookie}=${paired.token}; Path=/kiosk; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}` } })
  }
  const kiosk = await kioskOf(request, env)
  if (!kiosk) return kioskUnpaired()
  const zone = (await env.DB.prepare("SELECT json_extract(data,'$.timeZone') AS zone FROM st_records WHERE id='studio'").first<{ zone: string }>())?.zone ?? 'UTC'
  try {
    if (request.method === 'GET' && path === '/kiosk') return kioskHome()
    if (request.method === 'POST' && path === '/kiosk/lookup') return kioskResults(zone, await kioskRead(env.DB, kiosk.id, form.q))
    if (request.method === 'POST' && (path === '/kiosk/checkin' || path === '/kiosk/scan')) return kioskDone(zone, await kioskCommand(env.DB, kiosk.id, path === '/kiosk/scan' ? 'scan' : 'checkin', form))
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    if (error.status === 401) return kioskUnpaired()
    // Unknown codes, other members' seats and closed windows read alike.
    return kioskHome(kioskMessage(refusals[error.code] ?? (error.code === 'conflict_refresh_and_retry' ? 'That did not go through. Please try again.' : refusals.no_booking_found)), error.status)
  }
  return kioskUnpaired(404)
}

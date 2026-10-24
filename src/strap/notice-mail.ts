import type { Bindings } from '../auth.server'
// @ts-ignore The pinned Base mail module is JavaScript without declarations here.
import { createMailSender } from '../modules/mail/index.mjs'

// SCHED-008 closure and MSG-004 waitlist member email through the installation's configured Base mail
// provider (MAIL_PROVIDER rer, resend, sendgrid or cloudflare with its key, from
// MAIL_FROM), built here rather than through the sign-in sender. Development,
// demo or missing configuration means no email: members get the in-app notice.
const remote = ['rer', 'resend', 'sendgrid', 'cloudflare']
export const memberMailConfigured = (env: Bindings) => env.RER_DEMO !== '1' && remote.includes(env.MAIL_PROVIDER ?? '') && !!env.MAIL_API_KEY && !!env.MAIL_FROM
  && (env.MAIL_PROVIDER !== 'cloudflare' || !!env.MAIL_ACCOUNT_ID)
  && (env.MAIL_PROVIDER !== 'rer' || !!env.MAIL_RELAY_URL)

type Row = { id: string; recipient: string; subject: string; body: string }

/** Sends the rows reserved by this confirmation, each claimed once. A send that
 * is interrupted or ends without a clear provider answer is recorded as such
 * and never retried. */
export async function sendNotices(env: Bindings, ids: string[]) {
  if (!ids.length || !memberMailConfigured(env)) return
  const sender = createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'rer' ? { relayUrl: env.MAIL_RELAY_URL } : {}), ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) })
  for (const id of ids) {
    const row = await env.DB.prepare("UPDATE st_notice_deliveries SET status='sending',attempted_at=? WHERE id=? AND status='queued' RETURNING id,recipient,subject,body").bind(Date.now(), id).first<Row>()
    if (!row) continue
    let result: { status: string; provider?: string; providerMessageId?: string | null; code?: string }
    try {
      result = await sender.send({ deliveryId: row.id, ...(env.MAIL_PROVIDER === 'rer' ? { messageKey: row.id } : {}), from: env.MAIL_FROM, to: [row.recipient], subject: row.subject, text: row.body })
    } catch {
      result = { status: 'uncertain', provider: env.MAIL_PROVIDER, code: 'provider_outcome_unknown' }
    }
    await env.DB.prepare("UPDATE st_notice_deliveries SET status=?,provider=?,provider_message_id=?,code=?,finished_at=? WHERE id=? AND status='sending'")
      .bind(result.status, result.provider ?? env.MAIL_PROVIDER ?? null, result.providerMessageId ?? null, result.code ?? null, Date.now(), row.id).run()
  }
}

export async function noticeDeliveries(env: Bindings, role: string) {
  if (role !== 'owner') return []
  return (await env.DB.prepare('SELECT id,source_kind AS sourceKind,source_id AS sourceId,person_id AS personId,status,provider,code FROM st_notice_deliveries ORDER BY created_at,id').all()).results
}

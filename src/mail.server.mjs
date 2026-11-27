import { createMailSender } from './modules/mail/index.mjs'

export function operatorMail(env) {
 if (env.RER_DEMO === '1' || env.AUTH_LOCAL === 'true') {
  return createMailSender({ provider: 'development', mode: 'development' })
 }
 // MAIL_PROVIDER=none: the studio runs without outbound mail; no sender exists and nothing is sent (mail_off).
 if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'development' || env.MAIL_PROVIDER === 'none') return undefined
 return {
  async send(message) {
   return createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'rer' ? { relayUrl: env.MAIL_RELAY_URL } : {}), ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }).send(message)
  },
 }
}

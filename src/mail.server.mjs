import { createMailSender } from './modules/mail/index.mjs'
import { createD1DevelopmentOutbox } from './modules/mail/src/development/index.mjs'

export function operatorMail(env) {
 if (env.RER_DEMO === '1' || env.AUTH_LOCAL === 'true') {
  const sender = createMailSender({ provider: 'development', mode: 'development' })
  // Member invitations need an inspectable local delivery destination. Nothing
  // leaves this machine; use the shared retained-outbox storage deliberately.
  const outbox = createD1DevelopmentOutbox({ db: env.DB })
  return { async send(message) {
   const result = await sender.send(message)
   await outbox.put(message)
   return result
  } }
 }
 if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'development') return undefined
 return {
  async send(message) {
   return createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }).send(message)
  },
 }
}

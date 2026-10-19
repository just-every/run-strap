// Test-only mail transport edge: retain messages for following real sign-in links.
import { createD1DevelopmentOutbox } from '../src/modules/mail/src/development/index.mjs'
export const operatorMail = env => ({ send: async message => {
  await createD1DevelopmentOutbox({ db: env.DB }).put(message)
  if (env.TEST_MAIL_FAILURE === 'unknown') throw new Error('Test mail transport disconnected after request')
  return { status: 'development', provider: 'development' }
} })

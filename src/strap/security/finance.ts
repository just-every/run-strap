// SEC-004: a finance user is a staff identity. The owner grants it to an active person with an email
// (who then signs in through the ordinary invitation link); it reaches the revenue and collections
// report and its downloads, behind a second factor, and nothing else. A grant replaces nothing:
// revoking it returns the person to their member identity on the next request.
import type { Bindings } from '../../auth.server'
import { fail } from '../credentials'
import type { Actor } from '../domain'
import { auditRow } from './mfa'

export async function financeCommand(env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (who.role !== 'owner' || !who.isOwner) fail('owner_required', 403)
  const id = String(input.id ?? '')
  const person = await env.DB.prepare('SELECT id,name,email,role FROM st_people WHERE id=? AND active=1 AND erased_at IS NULL AND email IS NOT NULL').bind(id).first<{ id: string; name: string; email: string; role: string }>()
  if (!person) fail('Choose an active person with an email address', 409)
  const subject = { id: person!.id, email: person!.email }
  if (name === 'finance.grant') {
    if (person!.role !== 'member') fail('Only a member identity can become a finance user', 409)
    if (await env.DB.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=lower(?) AND role='owner'").bind(person!.email).first()) fail('An owner already reaches every report', 409)
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO st_finance_users(person_id,granted_by,granted_at) VALUES(?,?,?)').bind(person!.id, who.id, Date.now()), auditRow(env, who, 'finance.grant', subject, { name: person!.name })])
    return { id: person!.id, finance: true }
  }
  if (name === 'finance.revoke') {
    await env.DB.batch([env.DB.prepare('DELETE FROM st_finance_users WHERE person_id=?').bind(person!.id), auditRow(env, who, 'finance.revoke', subject, { name: person!.name })])
    return { id: person!.id, finance: false }
  }
  return fail('Unknown finance command', 404)
}

export async function financeUsers(env: Bindings) {
  return (await env.DB.prepare('SELECT person_id AS personId,granted_by AS grantedBy,granted_at AS grantedAt FROM st_finance_users ORDER BY granted_at').all()).results
}

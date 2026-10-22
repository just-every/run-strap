// STUDIO-002: a manager is a staff identity for named locations. The owner grants it to an active person with an
// email (who signs in through the ordinary invitation link); it reaches the revenue and attendance reports of those
// locations, behind a second factor, and nothing else. A grant replaces nothing: revoking it returns the person to
// their member identity on the next request. Wider manager rights wait for STAFF-001.
import type { Bindings } from '../../auth.server'
import { fail } from '../credentials'
import type { Actor } from '../domain'
import { auditRow } from './mfa'

export async function managerCommand(env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (who.role !== 'owner' || !who.isOwner) fail('owner_required', 403)
  const id = String(input.id ?? '')
  const person = await env.DB.prepare('SELECT id,name,email,role FROM st_people WHERE id=? AND active=1 AND erased_at IS NULL AND email IS NOT NULL').bind(id).first<{ id: string; name: string; email: string; role: string }>()
  if (!person) fail('Choose an active person with an email address', 409)
  const subject = { id: person!.id, email: person!.email }
  if (name === 'manager.grant') {
    if (person!.role !== 'member') fail('Only a member identity can become a manager', 409)
    if (await env.DB.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=lower(?) AND role='owner'").bind(person!.email).first()) fail('An owner already reaches every report', 409)
    if (await env.DB.prepare('SELECT 1 FROM st_finance_users WHERE person_id=?').bind(person!.id).first()) fail('A finance user cannot also be a manager', 409)
    const studio = await env.DB.prepare("SELECT 1 AS ok FROM st_records WHERE id='studio'").first()
    const known = new Set([...(studio ? ['studio'] : []), ...(await env.DB.prepare("SELECT id FROM st_records WHERE kind='location'").all<{ id: string }>()).results.map(row => row.id)])
    const requested = Array.isArray(input.locationIds) ? input.locationIds.map(String) : []
    const locationIds = [...new Set(requested)].sort()
    if (!locationIds.length || locationIds.length > 50 || locationIds.some(value => !known.has(value))) fail('Choose at least one of the studio’s locations', 400)
    await env.DB.batch([env.DB.prepare('INSERT INTO st_managers(person_id,location_ids,granted_by,granted_at) VALUES(?,?,?,?) ON CONFLICT(person_id) DO UPDATE SET location_ids=excluded.location_ids,granted_by=excluded.granted_by,granted_at=excluded.granted_at')
      .bind(person!.id, JSON.stringify(locationIds), who.id, Date.now()), auditRow(env, who, 'manager.grant', subject, { name: person!.name, locationIds })])
    return { id: person!.id, manager: true, locationIds }
  }
  if (name === 'manager.revoke') {
    await env.DB.batch([env.DB.prepare('DELETE FROM st_managers WHERE person_id=?').bind(person!.id), auditRow(env, who, 'manager.revoke', subject, { name: person!.name })])
    return { id: person!.id, manager: false }
  }
  return fail('Unknown manager command', 404)
}

export async function managers(env: Bindings) {
  return (await env.DB.prepare('SELECT person_id AS personId,location_ids AS locationIds,granted_by AS grantedBy,granted_at AS grantedAt FROM st_managers ORDER BY granted_at').all()).results
    .map((row: any) => ({ ...row, locationIds: JSON.parse(row.locationIds) }))
}

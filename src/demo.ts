import type { Bindings } from './auth.server'
import { buildStudio } from './strap/demo/studio'
import { ownerName } from './strap/demo/timetable'

/** A complete, disposable first week, built with Strap's own domain commands. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }): Promise<void> {
  if (await env.DB.prepare("SELECT 1 FROM st_people WHERE id='demo-person-1'").first()) return
  const operator = await env.DB.prepare("SELECT id,email,role,status,version FROM oa_operators WHERE email=? AND role='owner'").bind(ownerEmail).first<any>()
  if (!operator) throw new Error('Demo owner is missing')
  const { people, records, version } = await buildStudio(env.DB, operator, now)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO st_people(id,name,email,role,active,version)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.email'),json_extract(value,'$.role'),json_extract(value,'$.active'),json_extract(value,'$.version') FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`).bind(JSON.stringify(people)),
    env.DB.prepare(`INSERT INTO st_records(id,kind,data,version)
      SELECT json_extract(value,'$.data.id'),json_extract(value,'$.kind'),json_extract(value,'$.data'),? FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`).bind(version, JSON.stringify(records)),
    env.DB.prepare('UPDATE st_meta SET version=? WHERE id=1').bind(version),
    // The sample studio's owner, as its sidebar and approvals name her.
    env.DB.prepare('UPDATE oa_operators SET display_name=? WHERE id=?').bind(ownerName, operator.id),
    env.DB.prepare('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING').bind(operator.id, now.getTime()),
  ])
}

// @ts-ignore The pinned Base module is JavaScript without declarations.
import { createPortability } from '@runeditrun/rer/modules/portability';
// @ts-ignore The CLI and Worker share this JavaScript archive policy.
import archivePolicy from '../archive-policy.mjs';
import { humanOwner, id, insist, integer, person, text } from './types';
import { savePhone } from './checkin';
import type { Transaction } from './store';

async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2,'0')).join('');
}
export async function savePerson(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const previous = input.id ? person(tx.state,text(input.id,'id',100),false) : null;
  if (previous && input.version !== undefined) insist(previous.version === integer(input.version,'version',1,Number.MAX_SAFE_INTEGER),'person_changed',409);
  const email = text(input.email,'email',254).toLowerCase(), name = text(input.name,'name',160);
  insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'invalid_email');
  const role = input.role ?? previous?.role ?? 'member', active = input.active ?? previous?.active ?? true;
  insist(role === 'member' || role === 'instructor','invalid_role'); insist(typeof active === 'boolean','invalid_active');
  insist(!tx.state.people.some(p => p.id !== previous?.id && p.email?.toLowerCase() === email),'email_already_used',409);
  const identityHash = await hash(email);
  insist(!await tx.db.prepare('SELECT 1 FROM st_erasure_journal WHERE identity_hash=?').bind(identityHash).first(),'erased_identity',409);
  // Rechecked in the atomic batch: erasure may have committed after the read.
  tx.sql.push(tx.statement('INSERT INTO st_assert(value) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM st_erasure_journal WHERE identity_hash=?) THEN 1 ELSE 0 END',identityHash));
  const saved = {id:previous?.id ?? id(),name,email,role,active,version:(previous?.version ?? 0)+1,erasedAt:null};
  if (input.phone !== undefined) { insist(role === 'member' || input.phone === '' || input.phone === null,'phone_is_for_members'); savePhone(tx,saved.id,input.phone); }
  tx.sql.push(tx.statement('INSERT INTO st_people(id,name,email,role,active,version) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,role=excluded.role,active=excluded.active,version=excluded.version',saved.id,name,email,role,active?1:0,saved.version));
  return saved;
}
export async function erasePerson(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const previous = person(tx.state,input.id,false);
  // The check-in record (phone, code) is personal data, not use: erasure removes it.
  const unused = `NOT EXISTS(SELECT 1 FROM st_records r,json_tree(r.data) j WHERE r.kind<>'memberCheckin' AND j.type='text' AND j.value=?)
    AND NOT EXISTS(SELECT 1 FROM oa_operators WHERE lower(email)=lower(?))
    AND NOT EXISTS(SELECT 1 FROM st_import_people_revisions WHERE person_id=?)
    AND NOT EXISTS(SELECT 1 FROM ik_provenance WHERE destination='strap:members' AND target_kind='member' AND target_id=?)
    AND NOT EXISTS(SELECT 1 FROM ik_d1_history WHERE destination='strap:members' AND target_kind='member' AND target_id=?)`;
  const args = [previous.id,previous.email,previous.id,previous.id,previous.id];
  const row = await tx.db.prepare(`SELECT CASE WHEN (${unused}) THEN 1 ELSE 0 END AS ok`).bind(...args).first<{ok:number}>();
  insist(row?.ok === 1,'only_unused_uninvited_nonimported_people_can_be_erased',409);
  tx.sql.push(tx.statement(`INSERT INTO st_assert(value) SELECT CASE WHEN (${unused}) THEN 1 ELSE 0 END`,...args));
  const portability = await createPortability({db:tx.db,policy:archivePolicy});
  tx.sql.push(...await portability.redactionStatements(),...await portability.invalidateTransfersStatements());
  tx.sql.push(tx.statement("DELETE FROM st_records WHERE kind='memberCheckin' AND id=?",`member-checkin:${previous.id}`));
  const erasedAt = Date.now();
  tx.sql.push(tx.statement('INSERT INTO st_erasure_journal(identity_hash,erased_at) VALUES(?,?)',await hash(previous.email!.toLowerCase()),erasedAt));
  tx.sql.push(tx.statement("UPDATE st_people SET name='Erased person',email=?,active=0,role='member',version=version+1,erased_at=? WHERE id=?",`erased-${previous.id}@invalid.local`,erasedAt,previous.id));
  return {id:previous.id,erased:true};
}

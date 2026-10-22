import { DomainError, insist, type Actor, type Person, type RecordData, type State } from './types';
import type { NoticeContext } from './notices';

type Native = State['operator'];
type PersonRow = Omit<Person, 'active' | 'erasedAt'> & { active: number; erased_at: number | null };
const asPerson = (p: PersonRow): Person => ({ id:p.id,name:p.name,email:p.email,role:p.role,active:!!p.active,version:p.version,erasedAt:p.erased_at });
function resolve(native: Native | undefined, people: Person[], requestedAgent = false, finance: string[] = [], managers: Map<string,string[]> = new Map(), recordStaff: string[] = []): Actor {
  insist(native?.status === 'active', 'signed_in_required', 401);
  const linked = people.find(p => p.active && !p.erasedAt && p.email?.toLowerCase() === native.email.toLowerCase());
  if (native.role === 'owner') return {id:native.id,email:native.email,role:requestedAgent?'agent':'owner',isOwner:true,...(linked && !requestedAgent ? {personId:linked.id}: {})};
  insist(!requestedAgent && linked, 'active_person_required', 403);
  if (recordStaff.includes(linked.id) && !finance.includes(linked.id) && !managers.has(linked.id)) return {id:native.id,email:native.email,role:'front-desk',personId:linked.id,isOwner:false};
  if (!finance.includes(linked.id) && managers.has(linked.id)) return {id:native.id,email:native.email,role:'manager',personId:linked.id,isOwner:false,locationIds:managers.get(linked.id)};
  return {id:native.id,email:native.email,role:finance.includes(linked.id) ? 'finance' : linked.role,personId:linked.id,isOwner:false};
}
const financeIds = (rows: unknown[]) => (rows as {person_id:string}[]).map(r => r.person_id);
const managerScopes = (rows: unknown[]) => new Map((rows as {person_id:string;location_ids:string}[]).map(r => [r.person_id,JSON.parse(r.location_ids) as string[]]));
export async function actor(db: D1Database, input: { userId: string; email: string; isOwner: boolean }): Promise<Actor> {
  const results = await db.batch([
    db.prepare('SELECT id,email,role,status,version FROM oa_operators WHERE id=?').bind(input.userId),
    db.prepare('SELECT * FROM st_people'), db.prepare('SELECT person_id FROM st_finance_users'), db.prepare('SELECT person_id,location_ids FROM st_managers'), db.prepare("SELECT json_extract(data,'$.personId') AS person_id FROM st_records WHERE kind='memberRecordGrant' AND json_extract(data,'$.enabled')=1"),
  ]);
  return resolve(results[0].results[0] as Native | undefined, (results[1].results as unknown as PersonRow[]).map(asPerson), false, financeIds(results[2].results), managerScopes(results[3].results), financeIds(results[4].results));
}
export async function load(db: D1Database, who: Actor): Promise<{ state: State; who: Actor }> {
  const rows = await db.batch([
    db.prepare('SELECT version FROM st_meta WHERE id=1'), db.prepare('SELECT * FROM st_people'),
    db.prepare('SELECT id,kind,data FROM st_records ORDER BY rowid'),
    db.prepare('SELECT id,email,role,status,version FROM oa_operators WHERE id=?').bind(who.id), db.prepare('SELECT person_id FROM st_finance_users'), db.prepare('SELECT person_id,location_ids FROM st_managers'), db.prepare("SELECT json_extract(data,'$.personId') AS person_id FROM st_records WHERE kind='memberRecordGrant' AND json_extract(data,'$.enabled')=1"),
  ]);
  const people = (rows[1].results as unknown as PersonRow[]).map(asPerson);
  const current = resolve(rows[3].results[0] as Native | undefined, people, who.role === 'agent', financeIds(rows[4].results), managerScopes(rows[5].results), financeIds(rows[6].results));
  insist(current.role === who.role && current.personId === who.personId && current.email === who.email && JSON.stringify(current.locationIds) === JSON.stringify(who.locationIds), 'actor_changed', 403);
  current.sessionId = who.sessionId;
  const meta = rows[0].results[0] as {version:number};
  const state: State = {version:Number(meta.version),people,operator:rows[3].results[0] as Native,records:new Map()};
  for (const row of rows[2].results as {id:string;kind:string;data:string}[]) state.records.set(row.id, {kind:row.kind,data:JSON.parse(row.data)});
  return {state,who:current};
}
/** A paired kiosk reads the studio's records through its own door only. */
export async function loadKiosk(db: D1Database, kioskId: string): Promise<{ state: State; who: Actor }> {
  const rows = await db.batch([
    db.prepare('SELECT version FROM st_meta WHERE id=1'), db.prepare('SELECT * FROM st_people'),
    db.prepare('SELECT id,kind,data FROM st_records ORDER BY rowid'),
    db.prepare('SELECT id FROM st_kiosks WHERE id=? AND revoked_at IS NULL AND token_hash IS NOT NULL').bind(kioskId),
  ]);
  insist(rows[3].results.length === 1,'kiosk_not_paired',401);
  const state: State = {version:Number((rows[0].results[0] as {version:number}).version),people:(rows[1].results as unknown as PersonRow[]).map(asPerson),
    operator:{id:kioskId,email:'',role:'kiosk',status:'active',version:0},records:new Map()};
  for (const row of rows[2].results as {id:string;kind:string;data:string}[]) state.records.set(row.id, {kind:row.kind,data:JSON.parse(row.data)});
  return {state,who:{id:kioskId,email:'',role:'kiosk',isOwner:false,kioskId}};
}
/** The scheduled sweep acts as the system: it only applies time-based rules
 * (MSG-004 offer expiry and the promotion that follows); no request reaches it. */
export async function loadSystem(db: D1Database): Promise<{ state: State; who: Actor }> {
  const rows = await db.batch([db.prepare('SELECT version FROM st_meta WHERE id=1'), db.prepare('SELECT * FROM st_people'), db.prepare('SELECT id,kind,data FROM st_records ORDER BY rowid')]);
  const state: State = {version:Number((rows[0].results[0] as {version:number}).version),people:(rows[1].results as unknown as PersonRow[]).map(asPerson),
    operator:{id:'system',email:'',role:'system',status:'active',version:0},records:new Map()};
  for (const row of rows[2].results as {id:string;kind:string;data:string}[]) state.records.set(row.id, {kind:row.kind,data:JSON.parse(row.data)});
  return {state,who:{id:'system',email:'',role:'system',isOwner:false}};
}
export class Transaction {
  sql: D1PreparedStatement[] = [];
  notices: NoticeContext = {};
  constructor(public db: D1Database, public state: State, public who: Actor) {}
  statement(sql: string, ...args: unknown[]) { return this.db.prepare(sql).bind(...args); }
  future(value: string) {
    // SQLite's clock is evaluated by the committing Worker, after any queue wait.
    this.sql.push(this.statement("INSERT INTO st_assert(value) SELECT CASE WHEN julianday(?)>julianday('now') THEN 1 ELSE 0 END",value));
  }
  reached(value: string) {
    this.sql.push(this.statement("INSERT INTO st_assert(value) SELECT CASE WHEN julianday(?)<=julianday('now') THEN 1 ELSE 0 END",value));
  }
  put(kind: string, data: RecordData) {
    this.state.records.set(data.id,{kind,data});
    this.sql.push(this.statement('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version', data.id,kind,JSON.stringify(data),this.state.version+1));
  }
  async commit() {
    const {who,state} = this;
    const p = who.personId ? state.people.find(p => p.id === who.personId) : null;
    const authorization = who.role === 'system' ? this.statement('INSERT INTO st_assert(value) SELECT 1')
      : who.role === 'kiosk'
      ? this.statement('INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_kiosks WHERE id=? AND revoked_at IS NULL AND token_hash IS NOT NULL) THEN 1 ELSE 0 END',who.kioskId)
      : who.isOwner
      ? this.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND status='active' AND role='owner' AND version=?) THEN 1 ELSE 0 END",who.id,who.email,state.operator.version)
      : this.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators o JOIN st_people p ON lower(p.email)=lower(o.email) WHERE o.id=? AND o.status='active' AND o.version=? AND p.id=? AND p.active=1 AND p.erased_at IS NULL AND p.role=? AND p.version=?) THEN 1 ELSE 0 END",who.id,state.operator.version,who.personId,who.role === 'front-desk' ? 'member' : who.role,p?.version);
    try {
      await this.db.batch([
        this.statement('INSERT INTO st_assert(value) SELECT CASE WHEN version=? THEN 1 ELSE 0 END FROM st_meta WHERE id=1',state.version),
        authorization,...this.sql,
        this.statement('UPDATE st_meta SET version=version+1 WHERE id=1'),this.statement('DELETE FROM st_assert'),
      ]);
    } catch (error) {
      const message = String(error);
      if (/st_assert|CHECK constraint|UNIQUE constraint|strap_commit_conflict/.test(message)) throw new DomainError('conflict_refresh_and_retry',409);
      throw error;
    }
  }
}

import { DomainError, insist, type Actor, type Person, type RecordData, type State } from './types';

type Native = State['operator'];
type PersonRow = Omit<Person, 'active' | 'erasedAt'> & { active: number; erased_at: number | null };
const asPerson = (p: PersonRow): Person => ({ id:p.id,name:p.name,email:p.email,role:p.role,active:!!p.active,version:p.version,erasedAt:p.erased_at });
function resolve(native: Native | undefined, people: Person[], requestedAgent = false): Actor {
  insist(native?.status === 'active', 'signed_in_required', 401);
  const linked = people.find(p => p.active && !p.erasedAt && p.email?.toLowerCase() === native.email.toLowerCase());
  if (native.role === 'owner') return {id:native.id,email:native.email,role:requestedAgent?'agent':'owner',isOwner:true,...(linked && !requestedAgent ? {personId:linked.id}: {})};
  insist(!requestedAgent && linked, 'active_person_required', 403);
  return {id:native.id,email:native.email,role:linked.role,personId:linked.id,isOwner:false};
}
export async function actor(db: D1Database, input: { userId: string; email: string; isOwner: boolean }): Promise<Actor> {
  const results = await db.batch([
    db.prepare('SELECT id,email,role,status,version FROM oa_operators WHERE id=?').bind(input.userId),
    db.prepare('SELECT * FROM st_people'),
  ]);
  return resolve(results[0].results[0] as Native | undefined, (results[1].results as unknown as PersonRow[]).map(asPerson));
}
export async function load(db: D1Database, who: Actor): Promise<{ state: State; who: Actor }> {
  const rows = await db.batch([
    db.prepare('SELECT version FROM st_meta WHERE id=1'), db.prepare('SELECT * FROM st_people'),
    db.prepare('SELECT id,kind,data FROM st_records ORDER BY rowid'),
    db.prepare('SELECT id,email,role,status,version FROM oa_operators WHERE id=?').bind(who.id),
  ]);
  const people = (rows[1].results as unknown as PersonRow[]).map(asPerson);
  const current = resolve(rows[3].results[0] as Native | undefined, people, who.role === 'agent');
  insist(current.role === who.role && current.personId === who.personId && current.email === who.email, 'actor_changed', 403);
  const meta = rows[0].results[0] as {version:number};
  const state: State = {version:Number(meta.version),people,operator:rows[3].results[0] as Native,records:new Map()};
  for (const row of rows[2].results as {id:string;kind:string;data:string}[]) state.records.set(row.id, {kind:row.kind,data:JSON.parse(row.data)});
  return {state,who:current};
}
export class Transaction {
  sql: D1PreparedStatement[] = [];
  constructor(public db: D1Database, public state: State, public who: Actor) {}
  statement(sql: string, ...args: unknown[]) { return this.db.prepare(sql).bind(...args); }
  future(value: string) {
    // SQLite's clock is evaluated by the committing Worker, after any queue wait.
    this.sql.push(this.statement("INSERT INTO st_assert(value) SELECT CASE WHEN julianday(?)>julianday('now') THEN 1 ELSE 0 END",value));
  }
  put(kind: string, data: RecordData) {
    this.state.records.set(data.id,{kind,data});
    this.sql.push(this.statement('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version', data.id,kind,JSON.stringify(data),this.state.version+1));
  }
  async commit() {
    const {who,state} = this;
    const p = who.personId ? state.people.find(p => p.id === who.personId) : null;
    const authorization = who.isOwner
      ? this.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND status='active' AND role='owner' AND version=?) THEN 1 ELSE 0 END",who.id,who.email,state.operator.version)
      : this.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators o JOIN st_people p ON lower(p.email)=lower(o.email) WHERE o.id=? AND o.status='active' AND o.version=? AND p.id=? AND p.active=1 AND p.erased_at IS NULL AND p.role=? AND p.version=?) THEN 1 ELSE 0 END",who.id,state.operator.version,who.personId,who.role,p?.version);
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

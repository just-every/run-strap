import { operatorAuth, type Bindings } from '../auth.server';
import type { RecordData } from './domain/types';

/** The once-only dispatch claim commits before native auth can mint or send a
 * link. Interrupted sends remain uncertain and never get another automatic try. */
export async function sendWaiverLaunch(request: Request, env: Bindings, launch: RecordData) {
  const claimed = await env.DB.prepare("UPDATE st_waiver_launch_dispatches SET status='sending',attempted_at=? WHERE id=? AND status='queued' AND origin=? RETURNING id")
    .bind(Date.now(),launch.id,env.AUTH_ORIGIN).first();
  if (!claimed) {
    const existing = await env.DB.prepare('SELECT status FROM st_waiver_launch_dispatches WHERE id=?').bind(launch.id).first<{status:string}>();
    return {...launch,status:existing?.status ?? launch.status};
  }
  const member = await env.DB.prepare('SELECT name,email FROM st_people WHERE id=? AND active=1 AND erased_at IS NULL').bind(launch.personId).first<{name:string;email:string}>();
  let status = 'not_sent', code: string | null = 'member_unavailable';
  if (member) {
    try {
      const native = await env.DB.prepare('SELECT status FROM oa_operators WHERE lower(email)=lower(?)').bind(member.email).first<{status:string}>();
      const auth = operatorAuth(env);
      const result = native?.status === 'active'
        ? await auth.requestMagicLink(request,{email:member.email,returnTo:'/app#waiver'})
        : await auth.invite(request,{email:member.email,displayName:member.name,role:'member',returnTo:'/app#waiver'});
      status = 'requiredProvider' in result && result.requiredProvider ? 'not_sent' : 'requested';
      code = status === 'not_sent' ? 'member_uses_identity_provider' : null;
    } catch (error) {
      status = Number((error as {status?:number}).status) >= 400 && Number((error as {status?:number}).status) < 500 ? 'not_sent' : 'uncertain';
      code = status === 'not_sent' ? 'authentication_request_refused' : 'authentication_outcome_unknown';
    }
  }
  await env.DB.prepare("UPDATE st_waiver_launch_dispatches SET status=?,code=?,finished_at=? WHERE id=? AND status='sending'").bind(status,code,Date.now(),launch.id).run();
  return {...launch,status};
}
export async function waiverLaunchStatuses(env: Bindings) {
  return (await env.DB.prepare('SELECT id,status,code FROM st_waiver_launch_dispatches').all()).results;
}

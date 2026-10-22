import { operatorAuth, type Bindings } from '../auth.server';
import { load, Transaction } from './domain/store';
import { requireMemberRecord } from './domain/member-records';
import { insist, list, now, person, text, type Actor } from './domain/types';
import { retainStaffAction, staffChannel } from './domain/staff-actions';
import { hash } from './credentials';

/** A recorded explicit dispatch; interrupted/uncertain attempts never resend on replay. */
export async function inviteMemberRecord(request: Request,env: Bindings,who: Actor,input: Record<string,unknown>) {
  const loaded = await load(env.DB,who), tx = new Transaction(env.DB,loaded.state,loaded.who);
  requireMemberRecord(tx.state,tx.who,input.personId);
  const member = person(tx.state,input.personId); insist(member.role === 'member' && member.email,'member_email_required',409);
  const requestId = text(input.requestId,'requestId',100), channel = staffChannel(input);
  const eventId = 'member-invitation:'+await hash(who.id+':'+requestId), prior = tx.state.records.get(eventId)?.data;
  if (prior) { insist(prior.personId === member.id && prior.email === member.email && prior.channel === channel,'invitation_request_changed',409);return prior; }
  const event = {id:eventId,personId:member.id,email:member.email,requestId,channel,status:'requested',at:now(),actorId:who.id};
  tx.put('memberInvitation',event);
  retainStaffAction(tx,'member.record.invite','member-record',input,event,null,new Set(list(tx.state,'staffAction').map(r => r.id)));
  await tx.commit();
  let status = 'submitted';
  try { await operatorAuth(env).invite(request,{email:member.email,displayName:member.name,role:'member',returnTo:'/app'}); }
  catch { status = 'uncertain'; }
  const next = await load(env.DB,who), finish = new Transaction(env.DB,next.state,next.who);
  const saved = {...event,status,finishedAt:now()};finish.put('memberInvitation',saved);await finish.commit();return saved;
}

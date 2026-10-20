import { humanOwner,id,insist,now,person,text } from './types';
import type { Transaction } from './store';

/** An ordinary sign-in destination carries no credential, person session or
 * delegated authority. The member must independently sign in and choose. */
export function launchRecognition(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);text(input.requestId,'requestId',100);
  const member=person(tx.state,input.personId);insist(member.role==='member','member_required');
  const launch={id:id(),personId:member.id,preferenceDoor:true,url:'/signin?returnTo=%2Fapp%2Frecognition',status:'member_action_required',createdAt:now(),createdBy:tx.who.id};
  tx.put('recognitionLaunch',launch);return launch;
}

import type { Actor } from './types';
import type { Transaction } from './store';
import type { NoticeContext } from './notices';
type Run = (tx: Transaction, input: Record<string,unknown>, context: NoticeContext) => any;
export interface MemberDoor { staff: string; right: string; ownStep?: boolean }
export function defineCommand(run: Run, roles: Actor['role'][], options: {member?: MemberDoor; staffRight?: string; denial?: string} = {}) {
  if (roles.includes('member') && !options.member) throw new Error('Member command requires its staff door');
  return {run,roles,...options};
}

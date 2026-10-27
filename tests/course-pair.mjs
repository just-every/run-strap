import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export const courseTerms = (extra={}) => ({name:'Six-week course',locationId:'studio',capacity:2,depositCents:10000,installments:[{dueAt:'2098-01-15T00:00:00Z',amountCents:20000},{dueAt:'2098-01-29T00:00:00Z',amountCents:30000}],sessions:Array.from({length:6},(_,i)=>{const start=new Date(Date.UTC(2098,0,8+i*7,10));return {start:start.toISOString(),end:new Date(+start+3600000).toISOString()}}),confirmPolicy:true,...extra})
export async function coursePair(h,door,checkAudit) {
  const payer=await h.person('CoursePairPayer'),course=await h.cmd('course.publish',courseTerms()),p=await h.cmd('course.enrollment.prepare',{courseId:course.id,personId:payer.id,requestId:randomUUID()});
  for(const w of (await h.state()).waivers.filter(w=>!w.service || w.service===course.name))await h.cmd('waiver.acknowledge',{id:w.id,signerName:payer.name,documentHash:w.documentHash,confirm:true},payer.cookie)
  const input={id:p.id,requestId:randomUUID(),channel:'phone'},r=await checkAudit(door,input);
  assert.equal(r.result.status,'member_action_required');assert.equal(r.event.right,'sale');
  assert.equal((await h.state()).courseTuition.enrollments.length,0,'staff launch does not accept or enroll');
  await h.cmd('course.accept',{id:p.id,key:p.key,confirm:true},payer.cookie);
  const e=await h.cmd('course.enrollment.confirm',{id:p.id,key:p.key,confirm:true,requestId:randomUUID(),channel:'phone'});
  assert.equal(e.payerId,payer.id);assert.equal(e.amountCents,60000);
  await h.cmd(door,input);assert.equal((await h.state()).staffActions.filter(a=>a.requestId===input.requestId).length,1);
}

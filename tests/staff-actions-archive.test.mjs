import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp,mkdir,mkdtemp,rm,symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { harness } from './harness.mjs'
const exec=promisify(execFile)
async function checkout(root) {
  await mkdir(root)
  for(const name of ['package.json','pnpm-lock.yaml','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','SEED-COMMAND-CONTRACT.md','OPERATIONS.md','.node-version','wrangler.jsonc','deploy.json','rer-setup.json','scripts','src','migrations'])await cp(name,join(root,name),{recursive:true})
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir')
}
async function archive(root,args) {
  const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'};delete env.RER_LOCAL_OPERATION;delete env.RER_LOCAL_STATE_PATH
  await exec(process.execPath,[resolve('node_modules/@runeditrun/rer/global/rer.mjs'),...args,'--no-queue'],{cwd:root,env,maxBuffer:2e6})
}
const setup=async(h,cookie)=>assert.equal((await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})).status,303)

test('STAFF-002 / STAFF-006 / MOVE-011: native restore carries waiver launch history without dispatch authority, pauses new staff links until explicit reconnect, and preserves member-owned sign-in', {timeout:240_000},async()=>{
  const temp=await mkdtemp(join(tmpdir(),'strap-staff-restore-')),source=join(temp,'source'),restored=join(temp,'restored'),file=join(temp,'studio.rer')
  let h
  try {
    await checkout(source);await checkout(restored)
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6})
    h=await harness({root:source});await setup(h,h.owner)
    const member=await h.person('Maya'),waiver=await h.cmd('waiver.publish',{text:'Only Maya can acknowledge this current studio waiver.'})
    await h.cmd('waiver.launch',{personId:member.id,waiverId:waiver.id,requestId:'source-link',channel:'phone'})
    assert.equal((await h.state()).memberMail.origin,h.origin,'the first explicit member link records its source installation')
    const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
    assert.ok(!('st_waiver_launch_dispatches'in portable.tables))
    const coach=await h.person('Leo','instructor')
    const effectiveAt=new Date(Date.now()+3000).toISOString(),start=new Date(Date.now()+60_000).toISOString(),d=new Date(start)
    const week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
    const payRule=await h.cmd('pay.rule.save',{effectiveAt,mode:'flat-class',rateCents:4500,minimumCents:0,cancellation:{treatment:'flat',amountCents:1500}})
    const payClass=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:'Morning Flow',start,end:new Date(Date.parse(start)+3600_000).toISOString(),capacity:10,instructorId:coach.id}]})).id})).classes[0]
    const closure=await h.cmd('closure.prepare',{scope:'class',classId:payClass.id,reason:'Studio holiday'})
    await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key})
    const payAdjustment=await h.cmd('pay.adjust',{classId:payClass.id,amountCents:500,reason:'Agreed holiday preparation',requestId:'holiday-preparation'})
    const originalPay=(await h.send('/api/strap/teaching-pay',undefined,h.owner)).value
    assert.equal(originalPay.totalCents,2000)
    const identity={auth:h.auth,owner:h.owner};await h.close();h=null
    await archive(source,['export','--output',file]);await archive(restored,['import','--input',file,'--yes'])
    h=await harness({root:restored,...identity})
    assert.equal((await h.send('/api/strap/state',undefined,identity.owner)).status,401)
    const owner=await h.signIn(h.auth.OWNER_EMAIL);await setup(h,owner)
    const memberCookie=await h.signIn(member.email)
    assert.equal((await h.send('/app',undefined,memberCookie)).status,200,'ordinary member-owned native sign-in still works')
    const before=await h.state(owner),mailCount=(await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n
    assert.deepEqual(before.payRules,[payRule],'STAFF-002 immutable rate versions survive native restore')
    assert.deepEqual(before.teachingPay.rows,originalPay.rows,'STAFF-002 pay sources, arithmetic and adjustment history survive native restore')
    assert.equal(before.teachingPay.rows[0].adjustments[0].id,payAdjustment.id)
    assert.equal(before.waiverLaunches.length,1);assert.equal(before.staffActions.filter(a=>a.command==='waiver.launch').length,1)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_waiver_launch_dispatches').first()).n,0,'restore has no dispatch authority')
    const input={personId:member.id,waiverId:waiver.id,requestId:'restored-link',channel:'phone'}
    const refused=await h.send('/api/strap/command',{name:'waiver.launch',input},owner)
    assert.equal(refused.status,409);assert.equal(refused.value.error,'member_email_reconnect_required')
    assert.equal((await h.state(owner)).version,before.version,'refusal creates no launch or audit')
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,mailCount,'refusal sends no email')
    const profile=(await h.send('/app/people?person='+member.id,undefined,owner)).text
    assert.match(profile,/Review and reconnect in Studio/);assert.doesNotMatch(profile,/name=waiver.launch/)
    if(process.env.STRAP_PROOF_DIR)await(await import('./staff-actions-browser.mjs')).pausedWaiverBrowser(h,member.id,owner)
    await h.cmd('mail.connect',{},owner)
    assert.equal((await h.cmd('waiver.launch',input,owner)).status,'requested')
    assert.equal((await h.cmd('waiver.launch',input,owner)).status,'requested')
    const after=await h.state(owner)
    assert.equal(after.waiverLaunches.length,2);assert.equal(after.staffActions.filter(a=>a.command==='waiver.launch').length,2)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_waiver_launch_dispatches').first()).n,1)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').first()).n,mailCount+1,'explicit reconnect permits one new send, never a replay of history')
    assert.equal(after.acknowledgements.length,0,'staff request never acknowledges for the member')
  } finally {if(h)await h.close();await rm(temp,{recursive:true,force:true})}
})

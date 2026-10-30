import assert from 'node:assert/strict'

// Owner catalog management and exact termination review share the public command door.
export async function terminationReasonCases(h,{nina,stranger,sell,agree}) {
  const save=(input,cookie=h.owner,status=200)=>h.cmd('plan.cancellation.reason.save',input,cookie,status)
  const reason=await save({code:'moved-away',label:'Moved away',active:true,revision:0})
  const pack=await sell(nina);await agree(pack,nina)
  const input={packId:pack.id,reasonCode:reason.code,reason:'Member is relocating',effectiveAt:new Date(Date.now()+30*86400000).toISOString(),requestId:'synthetic-strap-reason-preview'}
  const before=await h.state()
  for(const cookie of [nina.cookie,stranger.cookie])await save({code:'price',label:'Price',active:true,revision:0},cookie,403)
  const key=await h.cmd('agent.create',{label:'Termination preparation'})
  for(const [name,body] of [['plan.cancellation.reason.save',{code:'price',label:'Price',active:true,revision:0}],['plan.cancellation.prepare',input]]){
    const version=(await h.state()).version
    assert.equal((await h.send('/api/strap/agent/command',{name,input:body},'',{authorization:'Bearer '+key.token})).status,403)
    assert.equal((await h.state()).version,version)
  }
  for(const reasonCode of [undefined,'unconfigured']){
    const version=(await h.state()).version
    await h.cmd('plan.cancellation.prepare',{...input,reasonCode,requestId:'synthetic-strap-reason-missing'},h.owner,reasonCode?404:400)
    assert.equal((await h.state()).version,version)
  }
  const preview=await h.cmd('plan.cancellation.prepare',input)
  assert.deepEqual([preview.reasonCode,preview.reasonLabel],['moved-away','Moved away'])
  const changed=await save({code:reason.code,label:'Relocated elsewhere',active:true,revision:reason.revision})
  assert.equal((await h.state()).cancellations.cancellations.find(c=>c.id===preview.id).stale,true)
  let version=(await h.state()).version
  await h.cmd('plan.cancellation.confirm',{id:preview.id,key:preview.key,requestId:'synthetic-strap-stale-label'},h.owner,409)
  assert.equal((await h.state()).version,version)
  const fresh=await h.cmd('plan.cancellation.prepare',{...input,requestId:'synthetic-strap-fresh-label'})
  await save({code:reason.code,label:changed.label,active:false,revision:changed.revision})
  version=(await h.state()).version
  await h.cmd('plan.cancellation.confirm',{id:fresh.id,key:fresh.key,requestId:'synthetic-strap-retired-preview'},h.owner,409)
  await h.cmd('plan.cancellation.prepare',{...input,requestId:'synthetic-strap-retired-selection'},h.owner,409)
  await save({code:reason.code,label:'Cannot overwrite history',active:true,revision:0},h.owner,409)
  assert.equal((await h.state()).version,version)
  const active=await save({code:reason.code,label:'Moved away',active:true,revision:3})
  const final=await h.cmd('plan.cancellation.prepare',{...input,requestId:'synthetic-strap-reason-final'})
  const confirm={id:final.id,key:final.key,requestId:'synthetic-strap-reason-confirm'}
  const confirmed=await h.cmd('plan.cancellation.confirm',confirm)
  await save({code:reason.code,label:'New catalog label',active:false,revision:active.revision})
  assert.deepEqual(await h.cmd('plan.cancellation.confirm',confirm),confirmed)
  const state=await h.state(),event=state.staffActions.find(a=>a.command==='plan.cancellation.confirm'&&a.after.id===confirmed.id)
  assert.deepEqual([event.after.reasonCode,event.after.reasonLabel],['moved-away','Moved away'])
  assert.equal(state.charges.length,before.charges.length,'catalog changes and termination review add no charge')
  assert.equal(state.recurring.invoices.length,before.recurring.invoices.length)
  assert.equal(confirmed.effects.finalChargeCents,0)
  assert.equal(confirmed.effectiveAt,input.effectiveAt)
  const catalogEvent=state.staffActions.find(a=>a.command==='plan.cancellation.reason.save'&&a.after.revision===5)
  assert.equal(catalogEvent.before.label,'Moved away');assert.equal(catalogEvent.after.label,'New catalog label')
  const audit=await h.send('/app/people',undefined,h.owner)
  assert.equal(audit.status,200,audit.text);assert.match(audit.text,/Moved away/);assert.match(audit.text,/New catalog label/)
  await h.setAuth({})
  assert.equal((await h.state()).cancellations.cancellations.find(c=>c.id===confirmed.id).reasonLabel,'Moved away','runtime restart preserves the reviewed label')
}

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
  for(const [name,body] of [['plan.cancellation.reason.save',{code:'price',label:'Price',active:true,revision:0}],['plan.cancellation.confirm',{id:'synthetic-strap-no-preview'}]]){
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
  console.log('PROBE PLAN-012 catalog: owner save and retirement -> stable codes, stale previews refused, confirmed labels and audit retained, amounts and dates unchanged; unauthorized catalog writes refused.');
  await h.setAuth({})
  assert.equal((await h.state()).cancellations.cancellations.find(c=>c.id===confirmed.id).reasonLabel,'Moved away','runtime restart preserves the reviewed label')
}


export async function terminationAgentCases(h,{sell,agree}) {
  const member=await h.person('TerminationDraftMember'),other=await h.person('TerminationDraftOther');
  const pack=await sell(member),terms=await agree(pack,member),otherPack=await sell(other),otherTerms=await agree(otherPack,other);
  let code=await h.cmd('plan.cancellation.reason.save',{code:'agent-move',label:'Moved away',active:true,revision:0});
  const key=await h.cmd('agent.create',{label:'Prepare reviewed terminations'}),headers={authorization:'Bearer '+key.token};
  const agent=async(name,input,status=200)=>{
    const response=await h.send('/api/strap/agent/command',{name,input},'',headers);
    assert.equal(response.status,status,response.text);return response.value.result??response.value;
  };
  const input={packId:pack.id,reasonCode:code.code,reason:'Member asked to end access',effectiveAt:new Date(Date.now()+30*86400000).toISOString(),requestId:'synthetic-strap-agent-termination'};
  // A preparation credential must not collect unrelated due native invoices or process other lifecycle effects.
  await h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify({...otherTerms,nextRenewalAt:new Date(Date.now()-1000).toISOString()}),otherTerms.id).run();
  const before=await h.state(),draft=await agent('plan.cancellation.prepare',input),after=await h.state();
  assert.deepEqual([draft.status,draft.createdRole,draft.reasonCode,draft.reasonLabel],['preview','agent','agent-move','Moved away']);
  for(const field of ['charges','payments','bookings','packCreditEvents','staffNotices','staffActions'])assert.deepEqual(after[field],before[field],field+' stays unchanged during preparation');
  assert.deepEqual(after.recurring,before.recurring);assert.deepEqual(after.packs,before.packs);
  const context=await h.send('/api/strap/agent/context',undefined,'',headers);assert.equal(context.status,200,context.text);
  assert.ok(context.value.cancellations.contracts.some(t=>t.id===terms.id&&t.packId===pack.id));
  assert.ok(context.value.cancellations.reasonCodes.some(r=>r.code===code.code));
  assert.equal(context.value.cancellations.cancellations.find(c=>c.id===draft.id).status,'preview');
  await h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify(otherTerms),otherTerms.id).run();
  const confirm={id:draft.id,key:draft.key,requestId:'synthetic-strap-agent-confirm'};
  for(const [name,body] of [['plan.cancellation.confirm',confirm],['plan.cancellation.stop',{packId:pack.id,requestId:'synthetic-strap-agent-stop'}],['plan.cancellation.withdraw.prepare',{id:draft.id,requestId:'synthetic-strap-agent-withdraw'}],['plan.cancellation.reason.save',{...code,active:false}]]) {
    const version=(await h.state()).version;await agent(name,body,403);assert.equal((await h.state()).version,version);
  }
  assert.equal((await h.send('/api/strap/command',{name:'plan.cancellation.confirm',input:confirm},'',headers)).status,401);
  code=await h.cmd('plan.cancellation.reason.save',{...code,label:'Relocation',revision:code.revision});
  assert.deepEqual(await agent('plan.cancellation.prepare',input),draft,'a retried draft retains the originally reviewed label');
  assert.equal((await h.state()).cancellations.cancellations.find(c=>c.id===draft.id).stale,true);
  await h.cmd('plan.cancellation.confirm',confirm,h.owner,409);
  const fresh=await agent('plan.cancellation.prepare',{...input,requestId:'synthetic-strap-agent-fresh'});
  assert.equal(fresh.reasonLabel,'Relocation');
  code=await h.cmd('plan.cancellation.reason.save',{...code,active:false,revision:code.revision});
  assert.deepEqual(await agent('plan.cancellation.prepare',input),draft);
  await agent('plan.cancellation.prepare',{...input,requestId:'synthetic-strap-agent-retired'},409);
  await h.cmd('plan.cancellation.confirm',{id:fresh.id,key:fresh.key,requestId:'synthetic-strap-agent-retired-confirm'},h.owner,409);
  code=await h.cmd('plan.cancellation.reason.save',{...code,active:true,revision:code.revision});
  const final=await agent('plan.cancellation.prepare',{...input,requestId:'synthetic-strap-agent-reviewed'});
  const page=await h.send('/app/packs?person='+member.id,undefined,h.owner);assert.equal(page.status,200,page.text);assert.match(page.text,/Agent-prepared draft/);
  if(process.env.STRAP_PROOF_DIR||process.env.STRAP_RIGHTS_PROOF_DIR)await(await import('./cancellations-browser.mjs')).terminationDraftBrowser(h,{member,draft:final});
  const committed=await h.cmd('plan.cancellation.confirm',{id:final.id,key:final.key,channel:'inbox',requestId:'synthetic-strap-human-termination'});
  assert.deepEqual([committed.status,committed.terminatedRole,committed.effectiveAt,committed.reasonLabel],['scheduled','owner',input.effectiveAt,'Relocation']);
  assert.deepEqual(committed.effects,final.effects);
  const state=await h.state(),audit=state.staffActions.filter(a=>a.command==='plan.cancellation.confirm'&&a.after.id===final.id);
  assert.equal(audit.length,1);assert.equal(audit[0].actorRole,'owner');assert.equal(state.recurring.invoices.length,before.recurring.invoices.length);
  await h.cmd('person.save',{id:member.id,name:member.name,email:member.email,role:'member',active:false});
  let version=(await h.state()).version;await agent('plan.cancellation.prepare',input,404);assert.equal((await h.state()).version,version);
  assert.equal((await h.send('/api/strap/agent/context',undefined,'',headers)).value.cancellations.cancellations.some(c=>c.personId===member.id),false);
  await h.cmd('agent.revoke',{id:key.id});version=(await h.state()).version;
  await agent('plan.cancellation.prepare',input,401);assert.equal((await h.state()).version,version);
  assert.equal((await h.send('/api/strap/agent/context',undefined,'',headers)).status,401);
  console.log('PROBE PLAN-012 agent drafts: owner-bound credential prepares Moved away with due unrelated invoice -> draft only, no invoice, charge, notice or audit execution; changed or retired reason refuses confirmation; human confirmation preserves exact effects; inactive member and revoked credential cannot replay.');
}

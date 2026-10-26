import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export function evidenceCopyMailEdge() {
  const calls=[];let status=202
  return {calls,setStatus:value=>{status=value},outbound:async request=>{
    assert.equal(request.url,'https://api.sendgrid.com/v3/mail/send','only the real mail provider edge is faked')
    const body=await request.json();calls.push(body)
    return new Response(null,{status,headers:{'x-message-id':'synthetic-strap-copy-'+calls.length}})
  },linkFor:email=>{
    const message=calls.findLast(call=>call.personalizations[0].to[0].email===email)
    assert.ok(message,'real transport submitted to the pre-recorded email')
    return message.content.find(part=>part.type==='text/plain').value.match(/http:\/\/[^\s]+\/evidence\/copy\?token=[a-f0-9]{64}/)[0]
  }}
}
export const copyPost=(h,path,fields,cookie='',extra={})=>h.mf.dispatchFetch(h.origin+path,{method:'POST',headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams(fields),redirect:'manual'})
export async function copyParticipant(h,suffix) {
  return h.cmd('member.record.create',{name:'Personal copy '+suffix,email:'synthetic-strap-copy-'+suffix.toLowerCase()+'@studio.example',channel:'desk',requestId:'synthetic-strap-copy-create-'+suffix})
}
export async function copyTablet(h,member,waiver,suffix) {
  const launch=await h.cmd('waiver.tablet.launch',{personId:member.id,waiverId:waiver.id,locationId:'studio',channel:'desk',requestId:'synthetic-strap-copy-tablet-'+suffix})
  const response=await copyPost(h,'/intake/tablet/start',{token:new URL(h.origin+launch.url).searchParams.get('token')})
  assert.equal(response.status,303);return {launch,cookie:response.headers.get('set-cookie').split(';')[0]}
}
async function expiredCopy(h,{edge,complete}) {
  const completed=await complete('Expiry',{emailCopy:'yes'}),link=new URL(edge.linkFor(completed.person.email)),path=link.href.slice(h.origin.length),token=link.searchParams.get('token')
  const row=await h.db.prepare('SELECT * FROM st_evidence_copies WHERE person_id=?').bind(completed.person.id).first()
  // Age the issued timestamps together, preserving the production-selected lifetime.
  // A one-hour lifetime would still allow the final public requests and fail this case.
  const age=minutes=>h.db.prepare("UPDATE st_evidence_copies SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,?),expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',expires_at,?) WHERE id=?").bind('-'+minutes+' minutes','-'+minutes+' minutes',row.id).run()
  await age(14)
  assert.equal((await h.send(path)).status,200,'an unused copy remains available fourteen minutes after its request')
  await age(2)
  const before=(await h.state()).version
  for(const response of [await h.send(path),await copyPost(h,'/evidence/copy',{token})]) {
    assert.equal(response.status,410,'the same copy refuses both doors sixteen minutes after its request')
    assert.ok(!response.headers.has('content-disposition'));assert.ok(!response.headers.has('set-cookie'))
  }
  assert.equal((await h.state()).version,before,'expiry refusal writes no product state')
  assert.equal((await h.db.prepare('SELECT consumed_at FROM st_evidence_copies WHERE id=?').bind(row.id).first()).consumed_at,null)
}
async function concurrentCopy(h,{edge,complete}) {
  const completed=await complete('Concurrent',{emailCopy:'yes'}),link=new URL(edge.linkFor(completed.person.email)),token=link.searchParams.get('token')
  const receipt=(await h.state()).acknowledgements.find(row=>row.personId===completed.person.id),original=await h.send('/api/strap/waiver-evidence.html?id='+receipt.id,undefined,h.owner)
  const requests=await Promise.allSettled([copyPost(h,'/evidence/copy',{token}),copyPost(h,'/evidence/copy',{token})])
  for(const request of requests)assert.equal(request.status,'fulfilled','both concurrent public requests finish normally')
  const responses=requests.map(request=>request.value)
  assert.deepEqual(responses.map(response=>response.status).sort((a,b)=>a-b),[200,410],'simultaneous consumers receive exactly one copy')
  for(const response of responses) {
    const body=await response.text();assert.ok(!response.headers.has('set-cookie'))
    if(response.status===200){assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(body,original.text)}
    else {assert.ok(!response.headers.has('content-disposition'));assert.ok(!body.includes(completed.person.name));assert.ok(!body.includes(receipt.id))}
  }
  const consumed=await h.db.prepare('SELECT consumed_at FROM st_evidence_copies WHERE receipt_id=?').bind(receipt.id).first();assert.ok(consumed.consumed_at)
  assert.equal((await h.send(link.href.slice(h.origin.length))).status,410)
  assert.equal((await copyPost(h,'/evidence/copy',{token})).status,410)
  assert.deepEqual(await h.db.prepare('SELECT consumed_at FROM st_evidence_copies WHERE receipt_id=?').bind(receipt.id).first(),consumed,'replay cannot consume again')
}
async function changedCopySources(h,{edge,complete,waiver}) {
  for(const kind of ['document','receipt']) {
    const completed=await complete('Source'+kind,{emailCopy:'yes'}),link=new URL(edge.linkFor(completed.person.email)),token=link.searchParams.get('token'),path=link.href.slice(h.origin.length)
    assert.equal((await h.send(path)).status,200,'the issued copy is available before its retained '+kind+' changes')
    const receipt=(await h.state()).acknowledgements.find(row=>row.personId===completed.person.id)
    const originals=(await h.db.prepare('SELECT id,data FROM st_records WHERE id IN (?,?)').bind(waiver.id,receipt.id).all()).results
    const document=JSON.parse(originals.find(row=>row.id===waiver.id).data),retained=JSON.parse(originals.find(row=>row.id===receipt.id).data)
    const replacements=kind==='receipt' ? [{...retained,signature:{...retained.signature,affirmationText:'Changed retained declaration'}}] : (()=>{
      const text='Changed retained source document',documentHash=createHash('sha256').update(text).digest('hex')
      // Keep document and signature internally consistent so only the issued-copy binding can refuse them.
      return [{...document,text,documentHash},{...retained,signature:{...retained.signature,documentText:text,documentHash}}]
    })()
    try {
      await h.db.batch(replacements.map(value=>h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify(value),value.id)))
      const before=(await h.state()).version
      for(const response of [await h.send(path),await copyPost(h,'/evidence/copy',{token})]) {
        assert.equal(response.status,410,'changed retained '+kind+' refuses the issued copy on GET and POST')
        assert.ok(!response.headers.has('content-disposition'));assert.ok(!response.headers.has('set-cookie'))
      }
      assert.equal((await h.state()).version,before)
      assert.equal((await h.db.prepare('SELECT consumed_at FROM st_evidence_copies WHERE receipt_id=?').bind(receipt.id).first()).consumed_at,null,'changed-source refusal does not consume or replace the copy')
    } finally {
      await h.db.batch(originals.map(row=>h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(row.data,row.id)))
    }
  }
}
async function uncertainCopyReplay(h,{edge,complete}) {
  edge.setStatus(503)
  const completed=await complete('Uncertain',{emailCopy:'yes'})
  assert.match(completed.text,/not confirmed/);assert.ok(!completed.text.includes('submitted for delivery'))
  const attempts=()=>edge.calls.filter(call=>call.personalizations[0].to[0].email===completed.person.email)
  assert.equal(attempts().length,1,'an uncertain provider response causes exactly one submission')
  const initial=await h.db.prepare('SELECT * FROM st_evidence_copies WHERE person_id=?').bind(completed.person.id).first()
  assert.equal(initial.delivery_status,'uncertain');assert.equal(initial.code,'provider_outcome_unknown');assert.ok(initial.attempted_at)
  edge.setStatus(202)
  const version=(await h.state()).version,receipts=(await h.state()).acknowledgements.filter(row=>row.personId===completed.person.id)
  const fields={signerName:completed.person.name,confirm:'yes',adultConfirmed:'yes',emailCopy:'yes'}
  assert.equal((await copyPost(h,'/intake/tablet',fields,completed.device.cookie)).status,410,'uncertain delivery cannot replay the consumed signing submission')
  assert.equal((await h.send('/intake/tablet',undefined,completed.device.cookie)).status,410)
  assert.equal((await h.send(completed.device.launch.url)).status,410,'the original handoff cannot dispatch the uncertain copy again')
  assert.equal((await h.state()).version,version)
  await(await h.mf.getWorker()).scheduled()
  assert.equal(attempts().length,1,'replay and a later scheduled dispatch opportunity never resend uncertain copy mail')
  assert.deepEqual(await h.db.prepare('SELECT * FROM st_evidence_copies WHERE person_id=?').bind(completed.person.id).first(),initial,'the original uncertain attempt remains the only retained copy dispatch')
  assert.deepEqual((await h.state()).acknowledgements.filter(row=>row.personId===completed.person.id),receipts)
}
export async function evidenceCopyJourney(h,{edge,guardian}) {
  await h.setAuth({MAIL_PROVIDER:'sendgrid',MAIL_FROM:'copies@studio.example',MAIL_API_KEY:'synthetic-strap-copy-mail'})
  await h.cmd('mail.connect',{})
  const waiver=await h.cmd('waiver.publish',{text:'Personal copy exact document <script>inert</script> & participant evidence.',requiresSignature:true})
  const member=await copyParticipant(h,'First'),tablet=await copyTablet(h,member,waiver,'First')
  const fields={signerName:member.name,confirm:'yes',adultConfirmed:'yes',emailCopy:'yes',email:'unrelated@studio.example'}
  assert.ok(!(await h.send('/intake/tablet',undefined,tablet.cookie)).text.includes('name="emailCopy"'),'copy consent unavailable until separate owner review')
  assert.equal((await copyPost(h,'/intake/tablet',fields,tablet.cookie)).status,409)
  assert.ok(!(await h.state()).acknowledgements.some(row=>row.personId===member.id),'unavailable requested copy refuses the completion transaction')
  const fresh=await h.signIn('owner@studio.example')
  await h.cmd('waiver.copy.mail.review',{confirm:true},fresh,403)
  assert.equal(await h.db.prepare('SELECT id FROM st_evidence_copy_mail').first(),null)
  await h.cmd('waiver.copy.mail.review',{confirm:false},h.owner,400)
  await h.cmd('waiver.copy.mail.review',{confirm:true})
  const form=(await h.send('/intake/tablet',undefined,tablet.cookie)).text
  for(const name of ['adultConfirmed','emailCopy'])assert.match(form,new RegExp('name="'+name+'" value="yes">'),'personal consents start unchecked')
  assert.equal((await copyPost(h,'/intake/tablet',{...fields,adultConfirmed:''},tablet.cookie)).status,409)
  let response=await copyPost(h,'/intake/tablet',fields,tablet.cookie);assert.equal(response.status,200)
  const locked=await response.text();assert.match(locked,/submitted for delivery/);assert.ok(!locked.includes('/evidence/copy?token='));assert.equal(edge.calls.length,1)
  const receipt=(await h.state()).acknowledgements.find(row=>row.personId===member.id),link=edge.linkFor(member.email),secret=new URL(link).searchParams.get('token'),path=link.slice(h.origin.length)
  assert.equal(receipt.signature.authority.adultConfirmed,true)
  const row=await h.db.prepare('SELECT * FROM st_evidence_copies WHERE receipt_id=?').bind(receipt.id).first()
  assert.equal(row.token_hash,createHash('sha256').update(secret).digest('hex'));assert.ok(!JSON.stringify(row).includes(secret));assert.equal(row.delivery_status,'accepted')
  const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value
  assert.ok(!JSON.stringify(portable).includes(secret));assert.ok(!JSON.stringify(await h.state()).includes(secret));assert.ok(!JSON.stringify(await h.state(guardian.cookie)).includes(secret));assert.ok(!portable.tables.st_evidence_copies);assert.ok(!portable.tables.st_evidence_copy_mail)
  for(let scanner=0;scanner<2;scanner++){const neutral=await h.send(path);assert.equal(neutral.status,200);assert.ok(!neutral.text.includes(member.name));assert.ok(!neutral.text.includes(waiver.text));assert.ok(!neutral.headers.has('set-cookie'))}
  assert.equal((await h.send(path,undefined,tablet.cookie)).status,403)
  assert.equal((await copyPost(h,'/evidence/copy',{token:secret},'',{origin:'https://unrelated.example','sec-fetch-site':'cross-site'})).status,403)
  assert.equal((await h.db.prepare('SELECT consumed_at FROM st_evidence_copies WHERE id=?').bind(row.id).first()).consumed_at,null)
  const original=await h.send('/api/strap/waiver-evidence.html?id='+receipt.id,undefined,h.owner)
  response=await copyPost(h,'/evidence/copy',{token:secret});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(await response.text(),original.text);assert.ok(!response.headers.has('set-cookie'))
  assert.equal((await h.send(path)).status,410);assert.equal((await copyPost(h,'/evidence/copy',{token:secret})).status,410)
  assert.equal((await h.send('/api/strap/state')).status,401);assert.equal((await h.send('/api/strap/state',undefined,'',{authorization:'Bearer '+secret})).status,401)
  assert.equal((await h.send('/api/strap/waiver-evidence.html?id='+receipt.id,undefined,guardian.cookie)).status,404,'unrelated member receives no evidence or existence confirmation')
  const complete=async(suffix,options={})=>{const person=await copyParticipant(h,suffix),device=await copyTablet(h,person,waiver,suffix),before=edge.calls.length;const result=await copyPost(h,'/intake/tablet',{signerName:person.name,confirm:'yes',adultConfirmed:'yes',...options},device.cookie);assert.equal(result.status,200);return {person,device,before,text:await result.text()}}
  const unchecked=await complete('Unchecked');assert.equal(edge.calls.length,unchecked.before,'no outbound without separate request')
  await expiredCopy(h,{edge,complete})
  await concurrentCopy(h,{edge,complete})
  await changedCopySources(h,{edge,complete,waiver})
  const changed=await complete('Changed',{emailCopy:'yes'}),changedLink=edge.linkFor(changed.person.email)
  await h.cmd('person.save',{...changed.person,email:'synthetic-strap-copy-new@studio.example'});assert.equal((await h.send(changedLink.slice(h.origin.length))).status,410,'email changes invalidate outstanding copy credentials')
  const inactive=await complete('Inactive',{emailCopy:'yes'}),inactiveLink=edge.linkFor(inactive.person.email)
  const disabled=await h.cmd('person.save',{...inactive.person,active:false});assert.equal((await h.send(inactiveLink.slice(h.origin.length))).status,410)
  await h.cmd('person.save',{...disabled,active:true});assert.equal((await h.send(inactiveLink.slice(h.origin.length))).status,410,'reactivation cannot revive the old version binding')
  const revoked=await complete('Revoked',{emailCopy:'yes'}),revokedLink=edge.linkFor(revoked.person.email)
  await h.cmd('waiver.copy.mail.review',{confirm:true});assert.equal((await h.send(revokedLink.slice(h.origin.length))).status,410,'renewed mail review invalidates outstanding copy links')
  await h.setAuth({MAIL_API_KEY:'synthetic-strap-copy-mail-rotated'})
  const unreviewed=await copyParticipant(h,'Unreviewed'),blocked=await copyTablet(h,unreviewed,waiver,'Unreviewed'),beforeBlocked=edge.calls.length
  assert.equal((await copyPost(h,'/intake/tablet',{signerName:unreviewed.name,confirm:'yes',adultConfirmed:'yes',emailCopy:'yes'},blocked.cookie)).status,409);assert.equal(edge.calls.length,beforeBlocked)
  let family=await h.cmd('household.save',{name:'Known dependent copy refusal'});family=await h.cmd('household.guardian.link',{id:family.id,guardianId:guardian.id,evidenceReference:'synthetic-strap-copy-guardian'});family=await h.cmd('household.participant.add',{id:family.id,name:'Known dependent'})
  const dependent=(await h.state()).people.find(person=>person.id===family.participantIds[0]);await h.cmd('person.save',{...dependent,email:'synthetic-strap-copy-dependent@studio.example'})
  await h.cmd('waiver.copy.mail.review',{confirm:true});const ward=await copyTablet(h,{...dependent,email:'synthetic-strap-copy-dependent@studio.example'},waiver,'Dependent')
  assert.equal((await copyPost(h,'/intake/tablet',{signerName:dependent.name,confirm:'yes',adultConfirmed:'yes',emailCopy:'yes'},ward.cookie)).status,409);assert.equal(edge.calls.length,beforeBlocked)
  await uncertainCopyReplay(h,{edge,complete})
  assert.equal(await h.db.prepare('SELECT id FROM oa_operators WHERE lower(email)=lower(?)').bind(member.email).first(),null,'copy request and possession create no native account')
  if(process.env.STRAP_PROOF_DIR||process.env.CI)await(await import('./evidence-copy-browser.mjs')).evidenceCopyBrowser(h,{edge,waiver})
}

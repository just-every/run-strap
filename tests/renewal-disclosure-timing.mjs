import assert from 'node:assert/strict'
import {readFile,writeFile,rename} from 'node:fs/promises'
import {run} from './harness.mjs'
import {totp} from './mfa-helpers.mjs'

// Run outside Verify with the existing process-local recovery clock. Only the
// clock advances: agreements, disclosures, invoices and mail use public doors.
export async function disclosureTiming(){
  const path=process.env.STRAP_RECOVERY_CLOCK,original=await readFile(path,'utf8');
  let offset=Number(original),sent=[];
  try{await run(async h=>{
    await h.confirmSetup(h.owner);
    const member=await h.person('TimingMember');let owner=h.owner,cookie=member.cookie;
    const cmd=(name,input,session=owner,status=200)=>h.cmd(name,input,session,status);
    const state=()=>h.state(owner),sweep=async()=>{await(await h.mf.getWorker()).scheduled();};
    const jump=async target=>{
      const realNow=Date.now()-offset*1000;offset=Math.ceil((Date.parse(target)-realNow)/1000);
      await writeFile(path+'.new',String(offset));await rename(path+'.new',path);
      await new Promise(resolve=>setTimeout(resolve,50));
      owner=await h.signIn('owner@studio.example');cookie=await h.signIn(member.email);
      await cmd('mfa.verify',{code:totp(h.mfaOwner.secret)});
    };
    const dueAt=new Date(Date.now()+32*86400000).toISOString(),terms=[],notices=[];
    for(let i=0;i<4;i++){
      const pack=await cmd('pack.approve',{id:(await cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:dueAt})).id});
      const proposal=await cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:12,noticeLeadDays:15,requestId:'synthetic-strap-timing-terms-'+i});
      const accepted=await cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},cookie);terms.push(accepted);
      const notice=await cmd('plan.disclosure.schedule',{termsId:accepted.id,leadDays:i===3?15:17,proposedAmountCents:12000,requestId:'synthetic-strap-timing-notice-'+i});notices.push(notice);
    }
    await cmd('mail.preference.save',{optedOut:true,requestId:'synthetic-strap-timing-optout'},cookie);
    await jump(new Date(Date.parse(notices[0].sendAt)-1000).toISOString());await sweep();
    assert.equal(sent.length,0,'no required email before the configured instant');
    await jump(new Date(Date.parse(notices[0].sendAt)+60000).toISOString());await sweep();await sweep();
    assert.equal(sent.length,3,'one email for each affected agreement despite opt-out');
    for(const message of sent){assert.deepEqual(message.to,[member.email]);for(const fact of ['$100.00','$120.00',dueAt])assert.ok(message.text.includes(fact));assert.match(message.text,/Stop immediately/);}
    const accepted=await cmd('plan.disclosure.accept',{id:notices[0].id,key:notices[0].key},cookie);
    assert.equal(accepted.acceptanceKey,notices[0].key);
    await cmd('plan.recurring.stop',{id:terms[2].id,requestId:'synthetic-strap-timing-stop'},cookie);
    await jump(new Date(Date.parse(notices[3].sendAt)+2*86400000).toISOString());await sweep();
    assert.equal(sent.length,4);
    assert.equal((await cmd('plan.disclosure.accept',{id:notices[3].id,key:notices[3].key},cookie,409)).error,'accepted_notice_period_not_met');
    assert.equal((await state()).recurring.invoices.length,0,'a personally accepted future price creates no early invoice');
    await jump(new Date(Date.parse(dueAt)+1000).toISOString());await sweep();await sweep();
    const end=await state(),invoices=end.recurring.invoices;
    for(const [index,amount] of [[0,12000],[1,10000],[3,10000]]){
      const rows=invoices.filter(row=>row.recurringTermsId===terms[index].id);assert.equal(rows.length,1);assert.equal(rows[0].amountCents,amount);
      assert.equal(end.charges.filter(c=>c.invoiceId===rows[0].id).length,1);
    }
    assert.equal(invoices.filter(row=>row.recurringTermsId===terms[2].id).length,0,'cancellation from the notice prevents renewal');
    assert.equal((await cmd('plan.disclosure.accept',{id:notices[1].id,key:notices[1].key},cookie,409)).error,'disclosure_not_accepting');
    console.log('PLAN-008 elapsed clock: pre-lead 0 emails; lead 3 emails; delayed notice refused; due accepted $120, unaccepted $100, late $100, cancelled 0 invoices; replay once.');
  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-strap-timing',MAIL_FROM:'studio@studio.example'},outbound:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails');const message=await request.json();
    if(message.subject==='Proposed price change disclosure')sent.push(message);
    return Response.json({id:'synthetic-strap-timing-mail-'+sent.length});
  }})}finally{await writeFile(path+'.new',original);await rename(path+'.new',path);}
}

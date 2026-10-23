import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp,mkdir,mkdtemp,rm,symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { harness } from './harness.mjs'
const exec=promisify(execFile)
async function checkout(root){await mkdir(root);for(const name of ['package.json','pnpm-lock.yaml','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','SEED-COMMAND-CONTRACT.md','OPERATIONS.md','.node-version','wrangler.jsonc','deploy.json','rer-setup.json','scripts','src','migrations'])await cp(name,join(root,name),{recursive:true});await symlink(resolve('node_modules'),join(root,'node_modules'),'dir')}
async function archive(root,args){const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'};delete env.RER_LOCAL_OPERATION;delete env.RER_LOCAL_STATE_PATH;await exec(process.execPath,[resolve('node_modules/@runeditrun/rer/global/rer.mjs'),...args,'--no-queue'],{cwd:root,env,maxBuffer:2e6})}
test('Native restore retains stock, sale receipts, drawer counts and once-only request identities',{timeout:240000},async()=>{
  const temp=await mkdtemp(join(tmpdir(),'strap-retail-restore-')),source=join(temp,'source'),restored=join(temp,'restored'),file=join(temp,'retail.rer');let h;
  try{
    await checkout(source);await checkout(restored);await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6});
    h=await harness({root:source});await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});
    const member=await h.person('Shopper'),supplier=await h.cmd('retail.supplier.add',{name:'Apparel',reference:'synthetic-strap-archive',requestId:'supplier'}),sku=await h.cmd('retail.sku.add',{name:'Shirt',sku:'S',barcode:'synthetic-strap-archive',variant:'Small',supplierId:supplier.id,priceCents:2000,lowStock:1,requestId:'sku'});
    await h.cmd('retail.receive',{skuId:sku.id,quantity:2,reference:'synthetic-strap-receive',requestId:'receive'});
    const drawer=await h.cmd('drawer.open',{register:'Desk',floatCents:15000,requestId:'open'}),input={skuId:sku.id,personId:member.id,quantity:1,expectedCents:2000,tender:'cash',sessionId:drawer.id,reference:'synthetic-strap-cash',requestId:'sale'};
    const sale=await h.cmd('retail.sell',input);await h.cmd('drawer.close',{sessionId:drawer.id,denominations:[{cents:1000,count:17}],requestId:'close'});
    const gift=await h.cmd('retail.gift.issue',{personId:member.id,recipientId:member.id,amountCents:10000,tender:'external',reference:'synthetic-strap-gift',requestId:'gift'});
    await h.cmd('retail.promotion.add',{code:'ARCHIVE',amountCents:500,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),maxUses:1,perMember:1,stackable:false,requestId:'promo'});
    const giftInput={skuId:sku.id,personId:member.id,quantity:1,expectedCents:1500,tender:'gift',giftCardId:gift.id,promoCodes:['ARCHIVE'],reference:'synthetic-strap-gift-sale',requestId:'gift-sale'},giftSale=await h.cmd('retail.sell',giftInput);
    const shift=await h.cmd('clock.in',{job:'Archive desk',requestId:'clock-in'}),endAt=new Date(Date.now()-60000).toISOString();await h.cmd('clock.correction.request',{shiftId:shift.id,revision:0,startAt:new Date(Date.parse(endAt)-3600000).toISOString(),endAt,breakMinutes:0,reason:'Missed clock-out',requestId:'clock-correction'});const approvalInput={shiftId:shift.id,revision:1,requestId:'clock-approve'},approval=await h.cmd('clock.approve',approvalInput);
    const beforeClock=(await h.send('/api/strap/time-clock',undefined,h.owner)).value;
    const before=(await h.send('/api/strap/retail',undefined,h.owner)).value,auth=h.auth;await h.close();h=null;
    await archive(source,['export','--output',file]);await archive(restored,['import','--input',file,'--yes']);
    h=await harness({root:restored,auth,owner:'old-session=invalid'});const owner=await h.signIn(auth.OWNER_EMAIL);await h.confirmSetup(owner);await h.enroll(owner);
    const after=(await h.send('/api/strap/retail',undefined,owner)).value;assert.deepEqual(after,before);assert.deepEqual(await h.cmd('retail.sell',input,owner),sale);
    const replay=(await h.send('/api/strap/retail',undefined,owner)).value;assert.equal(replay.sales.length,2);assert.equal(replay.movements.length,3);assert.equal(replay.sessions[0].expectedCents,17000);assert.equal(replay.sessions[0].countedCents,17000);assert.equal(replay.gifts.liabilityCents,8500);assert.deepEqual(await h.cmd('retail.sell',giftInput,owner),giftSale);assert.deepEqual(await h.cmd('clock.approve',approvalInput,owner),approval);
    const afterClock=(await h.send('/api/strap/time-clock',undefined,owner)).value;assert.deepEqual(afterClock,beforeClock);assert.ok((await h.send('/api/strap/time-clock.csv',undefined,owner)).text.includes(shift.id));
  }finally{if(h)await h.close();await rm(temp,{recursive:true,force:true})}
})

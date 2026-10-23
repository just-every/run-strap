import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const init=async h=>{await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});const member=await h.person('Shopper');const supplier=await h.cmd('retail.supplier.add',{name:'Studio Apparel',reference:'synthetic-strap-1',requestId:'supplier'});return {member,supplier}}
const variant=(supplier,size,priceCents=2000)=>({supplierId:supplier.id,sku:'SHIRT-'+size,barcode:'synthetic-strap-'+size,name:'Studio shirt',variant:size,priceCents,lowStock:1,requestId:'sku-'+size})
const receive=(sku,quantity,requestId,locationId='studio')=>({skuId:sku.id,quantity,reference:'synthetic-strap-'+requestId,requestId,locationId})
const sell=(member,sku,requestId,extra={})=>({personId:member.id,skuId:sku.id,locationId:'studio',quantity:1,expectedCents:sku.priceCents,tender:'external',reference:'synthetic-strap-'+requestId,requestId,...extra})
const retail=async h=>(await h.send('/api/strap/retail',undefined,h.owner)).value
const denied=async(h,name,input,cookie)=>{const version=(await h.state()).version;assert.equal((await h.send('/api/strap/command',{name,input},cookie)).status,403);assert.equal((await h.state()).version,version)}

test('Inventory reconciles variants, barcode sales, last-unit refusal, transfers, counts and explicit damaged returns through HTTP',{timeout:120000},()=>run(async h=>{
  const {member,supplier}=await init(h),small=await h.cmd('retail.sku.add',variant(supplier,'S')),large=await h.cmd('retail.sku.add',variant(supplier,'L'));
  const annex=await h.cmd('location.save',{name:'Annex',timeZone:'America/Los_Angeles'});
  const purchase=receive(small,1,'receive-small');const received=await h.cmd('retail.receive',purchase);assert.deepEqual(await h.cmd('retail.receive',purchase),received);
  await h.cmd('retail.receive',receive(large,3,'receive-large'));
  const saleInput=sell(member,small,'last-unit');delete saleInput.skuId;saleInput.barcode=small.barcode;
  const sale=await h.cmd('retail.sell',saleInput);assert.deepEqual(await h.cmd('retail.sell',saleInput),sale);
  const before=(await h.state()).version;
  assert.equal((await h.send('/api/strap/command',{name:'retail.sell',input:sell(member,small,'oversell')},h.owner)).status,409);
  assert.equal((await h.state()).version,before);
  assert.equal((await h.send('/api/strap/command',{name:'retail.sell',input:{...saleInput,quantity:2}},h.owner)).status,409);
  const transfer=await h.cmd('retail.transfer',{skuId:large.id,locationId:'studio',toLocationId:annex.id,quantity:2,reason:'Restock Annex',requestId:'transfer'});
  assert.deepEqual(transfer.movements.map(m=>m.quantity),[-2,2]);assert.equal(transfer.movements[0].sourceId,transfer.movements[1].sourceId);
  const returned=await h.cmd('retail.return',{saleId:sale.id,quantity:1,restock:false,reason:'Torn seam',requestId:'damaged'});assert.equal(returned.amountCents,2000);
  assert.equal((await h.send('/api/strap/command',{name:'retail.return',input:{saleId:sale.id,quantity:1,restock:true,reason:'Repeat',requestId:'repeat'}},h.owner)).status,409);
  await h.cmd('retail.count',{skuId:large.id,locationId:'studio',count:2,reason:'Physical count found one omitted unit',requestId:'count'});
  let r=await retail(h);assert.equal(r.stock.find(v=>v.skuId===small.id&&v.locationId==='studio').onHand,0);assert.equal(r.stock.find(v=>v.skuId===small.id&&v.locationId==='studio').low,true);
  assert.equal(r.stock.find(v=>v.skuId===large.id&&v.locationId===annex.id).onHand,2);
  for(const stock of r.stock){const trail=r.movements.filter(m=>m.skuId===stock.skuId&&m.locationId===stock.locationId);assert.equal(stock.onHand,trail.reduce((n,m)=>n+m.quantity,0));let n=0;for(const m of trail){assert.equal(m.before,n);n+=m.quantity;assert.equal(m.after,n)}}
  assert.equal(r.movements.find(m=>m.sourceId===returned.id).quantity,0);
  assert.equal((await h.send('/api/strap/retail?barcode='+small.barcode,undefined,h.owner)).value.lookup.id,small.id);
  const wrongPrice=await h.send('/api/strap/command',{name:'retail.sell',input:sell(member,large,'wrong-price',{expectedCents:1999})},h.owner);assert.equal(wrongPrice.status,409);
  await denied(h,'retail.receive',receive(small,1,'member-denied'),member.cookie);
  const instructor=await h.person('Teacher','instructor');await denied(h,'retail.transfer',{skuId:large.id,quantity:1},instructor.cookie);
  for(const cookie of [member.cookie,instructor.cookie]){assert.equal((await h.send('/api/strap/retail',undefined,cookie)).status,403);assert.equal((await h.state(cookie)).retail,null)}
  const revenue=(await h.send('/api/strap/reports/revenue',undefined,h.owner)).value;assert.equal(revenue.totals.netSalesCents,0);assert.equal(revenue.totals.netCollectionsCents,0);assert.ok(revenue.sources.some(x=>x.id===sale.chargeId));assert.ok(revenue.sources.some(x=>x.id===returned.paymentId));
  const exit=(await h.send('/api/strap/exit.json',undefined,h.owner)).value,records=exit.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}));for(const kind of ['sku','supplier','stockReceipt','stockMovement','retailSale','retailReturn','retailAction'])assert.ok(records.some(r=>r.kind===kind),kind+' is portable');
  if(process.env.STRAP_PROOF_DIR)await(await import('./retail-browser.mjs')).retailBrowser(h,{member,small,large});
}))

test('Drawer float, cash sales and refund, paid movement, denomination shortage and audited manager correction reconcile native receipts',{timeout:120000},()=>run(async h=>{
  const {member,supplier}=await init(h),sku=await h.cmd('retail.sku.add',variant(supplier,'M',3000));await h.cmd('retail.receive',receive(sku,5,'drawer-stock'));
  const session=await h.cmd('drawer.open',{locationId:'studio',register:'Front desk',floatCents:15000,requestId:'open'});
  assert.equal((await h.send('/api/strap/command',{name:'drawer.open',input:{locationId:'studio',register:'Front desk',floatCents:0,requestId:'duplicate'}},h.owner)).status,409);
  const first=await h.cmd('retail.sell',sell(member,sku,'cash-1',{tender:'cash',sessionId:session.id}));await h.cmd('retail.sell',sell(member,sku,'cash-2',{tender:'cash',sessionId:session.id}));
  await h.cmd('retail.sell',sell(member,sku,'external',{sessionId:session.id}));
  await h.cmd('retail.return',{saleId:first.id,quantity:1,restock:true,reason:'Unworn return',sessionId:session.id,requestId:'cash-refund'});
  const paid=await h.cmd('drawer.cash',{sessionId:session.id,kind:'paid_out',amountCents:1000,reason:'Courier postage',requestId:'paid-out'});assert.equal(paid.reason,'Courier postage');
  const close={sessionId:session.id,denominations:[{cents:10000,count:1},{cents:5000,count:1},{cents:1000,count:1},{cents:500,count:1}],reason:'Count verified twice; five dollars short',requestId:'close'};
  const report=await h.cmd('drawer.close',close);assert.equal(report.expectedCents,17000);assert.equal(report.countedCents,16500);assert.equal(report.varianceCents,-500);assert.deepEqual(await h.cmd('drawer.close',close),report);
  const version=(await h.state()).version;assert.equal((await h.send('/api/strap/command',{name:'retail.sell',input:sell(member,sku,'closed',{tender:'cash',sessionId:session.id})},h.owner)).status,409);assert.equal((await h.state()).version,version);
  await denied(h,'drawer.reopen',{sessionId:session.id,reason:'Not authorized',requestId:'denied'},member.cookie);
  await h.cmd('member.record.grant',{personId:member.id,enabled:true,memberIds:[member.id],canCreate:false});
  const frontDesk=await h.signIn(member.email);await h.enroll(frontDesk);
  await denied(h,'drawer.reopen',{sessionId:session.id,reason:'Front desk cannot reopen',requestId:'desk-denied'},frontDesk);
  const adjusted=await h.cmd('drawer.adjust',{sessionId:session.id,countedCents:17000,reason:'Found five dollars beneath cash tray',requestId:'adjust'});assert.equal(adjusted.before,16500);assert.equal(adjusted.after,17000);assert.ok(adjusted.actorId);
  const r=await retail(h),saved=r.sessions.find(s=>s.id===session.id);assert.equal(saved.varianceCents,0);assert.equal(saved.entries.filter(e=>e.kind==='paid_out')[0].reason,'Courier postage');assert.equal(r.adjustments.length,1);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),day=(await h.send('/api/strap/retail/day?date='+date,undefined,h.owner)).value;assert.equal(day.totals.find(t=>t.tender==='cash').amountCents,3000);assert.equal(day.totals.find(t=>t.tender==='external').amountCents,3000);assert.equal(day.sources.length,4);
  const csv=await h.send('/api/strap/retail/day.csv?date='+date,undefined,h.owner);assert.equal(csv.status,200);assert.equal(csv.text.trim().split('\n').length,5);
  assert.equal((await h.send('/api/strap/retail/day.csv?date='+date,undefined,frontDesk)).status,403);
  const exit=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;for(const kind of ['drawerSession','drawerEntry','drawerAdjustment'])assert.ok(exit.tables.st_records.some(r=>r.kind===kind));
  if(process.env.STRAP_PROOF_DIR)await(await import('./retail-browser.mjs')).drawerBrowser(h,session.id);
}))

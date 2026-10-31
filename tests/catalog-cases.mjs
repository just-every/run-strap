import assert from 'node:assert/strict';

export const catalogTerms = {code:'synthetic-strap-pack',name:'Mat ten',currency:'USD',credits:10,amountCents:18900,validDays:90,eligibleServices:['Mat'],locationId:'studio',eligibleLocations:['studio']};

export async function catalogPurchases(h,first,second) {
  const v1=await h.cmd('catalog.publish',{...catalogTerms,revision:0});
  const prepare=personId=>h.cmd('pack.prepare',{personId,catalogVersionId:v1.id});
  const draft=await prepare(first.id),sale=await h.cmd('pack.approve',{id:draft.id});
  const sold=(await h.state(first.cookie)).packs.find(p=>p.id===sale.id);
  assert.deepEqual(sold.catalogVersion,v1);
  assert.equal(sold.purchaseExpiresAt,draft.expiresAt);
  assert.deepEqual([sold.credits,sold.remaining,sold.amountCents,sold.purchaseAmountCents],[10,10,18900,18900]);
  assert.equal(Date.parse(draft.expiresAt)-Date.parse(draft.createdAt)<=90*86400000,true);
  const stale=await prepare(second.id);
  const west=await h.cmd('location.save',{name:'Catalog studio West',timeZone:'America/Los_Angeles'});
  const v2=await h.cmd('catalog.publish',{...catalogTerms,revision:1,name:'Mat twelve',credits:12,amountCents:21900,locationId:west.id,eligibleLocations:[west.id]});
  const before=await h.state();
  await h.cmd('pack.approve',{id:stale.id},h.owner,409);
  await h.cmd('pack.prepare',{personId:second.id,catalogVersionId:v1.id},h.owner,409);
  await h.cmd('catalog.publish',{...catalogTerms,revision:1},h.owner,409);
  assert.equal((await h.state()).version,before.version,'stale approval and stale publication change nothing');
  const secondDraft=await h.cmd('pack.prepare',{personId:second.id,catalogVersionId:v2.id});
  const secondSale=await h.cmd('pack.approve',{id:secondDraft.id});
  const waiting=await h.cmd('pack.prepare',{personId:first.id,catalogVersionId:v2.id});
  const v3=await h.cmd('catalog.publish',{...catalogTerms,revision:2,name:'Reformer five',credits:5,amountCents:25900,eligibleServices:['Reformer']});
  const retiredPreview=await h.cmd('pack.prepare',{personId:first.id,catalogVersionId:v3.id});
  await h.cmd('catalog.retire',{id:v3.productId,revision:3});
  const retired=await h.state();
  for (const id of [waiting.id,retiredPreview.id]) await h.cmd('pack.approve',{id},h.owner,409);
  await h.cmd('pack.prepare',{personId:first.id,catalogVersionId:v3.id},h.owner,409);
  assert.equal((await h.state()).version,retired.version,'retired product refuses preparation and approval without writes');
  for (const [member,id,version] of [[first,sale.id,v1],[second,secondSale.id,v2]]) {
    const state=await h.state(member.cookie),pack=state.packs.find(p=>p.id===id);
    assert.deepEqual(pack.catalogVersion,version,'later publications never rewrite sold terms');
    assert.deepEqual([pack.amountCents,pack.credits,pack.remaining,pack.eligibleServices,pack.eligibleLocations],[version.amountCents,version.credits,version.credits,version.eligibleServices,version.eligibleLocations]);
    assert.equal(state.charges.find(c=>c.packId===id).amountCents,version.amountCents);
    assert.equal(state.charges.find(c=>c.packId===id).catalogVersionId,version.id);
    assert.equal(state.productCatalog,null,'members read their purchased snapshot rather than private catalog management');
    const receipt=await h.send('/app/packs',undefined,member.cookie);
    assert.equal(receipt.status,200);
    assert.ok(receipt.text.includes(`data-catalog-version="${version.id}"`));
    assert.ok(receipt.text.includes(version.name));
  }
  assert.equal((await h.state(first.cookie)).packs.some(p=>p.id===secondSale.id),false,'other member purchase stays private');
  assert.deepEqual((await h.state()).productCatalog.versions,[v1,v2,v3]);
  return {first,second,sale,secondSale,v1,v2,v3,retiredPreview};
}

export async function assertCatalogRestored(h,data,cookie) {
  const state=await h.state(cookie);
  assert.deepEqual(state.productCatalog.versions.filter(v=>v.code===data.v1.code),[data.v1,data.v2,data.v3]);
  assert.equal(state.productCatalog.products.find(p=>p.id===data.v1.productId).active,false);
  for (const [id,version] of [[data.sale.id,data.v1],[data.secondSale.id,data.v2]]) {
    const pack=state.packs.find(p=>p.id===id);
    assert.deepEqual(pack.catalogVersion,version);
    assert.ok(pack.purchaseExpiresAt,'native restore retains original purchase expiration');
    assert.deepEqual([pack.amountCents,pack.purchaseAmountCents,pack.credits,pack.remaining],[version.amountCents,version.amountCents,version.credits,version.credits]);
    assert.equal(state.charges.find(c=>c.packId===id).amountCents,version.amountCents);
  }
  const before=state.version;
  await h.cmd('pack.approve',{id:data.retiredPreview.id},cookie,409);
  assert.equal((await h.state(cookie)).version,before);
}

/** Catalog kinds share original evidence; intro sales keep the existing eligibility fence. */
export async function catalogBreadth(h) {
  const fixedMember=await h.person('CatalogFixed'),dropMember=await h.person('CatalogDrop'),introMember=await h.person('CatalogIntro'),waitingMember=await h.person('CatalogIntroWaiting');
  const publish=(code,productKind,extra={})=>h.cmd('catalog.publish',{...catalogTerms,code,productKind,revision:0,...extra});
  const fixed=await publish('synthetic-strap-fixed','fixed-term',{name:'Fixed unlimited',amountCents:34500,validDays:60});
  const drop=await publish('synthetic-strap-drop','drop-in',{name:'Mat drop-in',amountCents:2500,validDays:30});
  const intro=await publish('synthetic-strap-intro','intro',{name:'First mat week',amountCents:3900,validDays:7,credits:3,eligibility:'new',limit:'person'});
  const sales=[];
  for(const [member,version] of [[fixedMember,fixed],[dropMember,drop]]) {
    const draft=await h.cmd('pack.prepare',{personId:member.id,catalogVersionId:version.id});
    const sale=await h.cmd('pack.approve',{id:draft.id});sales.push({id:sale.id,version,member});
    const pack=(await h.state(member.cookie)).packs.find(p=>p.id===sale.id);
    assert.deepEqual(pack.catalogVersion,version);
    assert.equal(pack.amountCents,version.amountCents);
    if(version.kind==='fixed-term') {assert.equal(pack.entitlement.kind,'unlimited');assert.equal(pack.credits,0);}
    else assert.deepEqual([pack.credits,pack.remaining],[1,1]);
  }
  const before=await h.state();
  await h.cmd('pack.prepare',{personId:introMember.id,catalogVersionId:intro.id},h.owner,409);
  await h.cmd('intro.preview',{offerId:intro.introOfferId,requestId:'synthetic-strap-unverified'},introMember.cookie,409);
  assert.equal((await h.state()).version,before.version,'catalog intros cannot bypass verification by using the ordinary pack door');
  for(const member of [introMember,waitingMember])await h.cmd('intro.identity.verify',{personId:member.id,householdChecked:true,reason:'Personal eligibility verified'});
  const preview=await h.cmd('intro.preview',{offerId:intro.introOfferId,requestId:'synthetic-strap-intro-first'},introMember.cookie);
  const waiting=await h.cmd('intro.preview',{offerId:intro.introOfferId,requestId:'synthetic-strap-intro-waiting'},waitingMember.cookie);
  assert.deepEqual(preview.catalogVersion,intro);
  const introSale=await h.cmd('intro.purchase',{id:preview.id,key:preview.key,confirm:true},introMember.cookie);
  sales.push({id:introSale.packId,version:intro,member:introMember});
  const repeat=await h.cmd('intro.purchase',{id:preview.id,key:preview.key,confirm:true},introMember.cookie);
  assert.equal(repeat.id,introSale.id,'accepted intro replay never creates a second charge');
  const intro2=await h.cmd('catalog.publish',{...catalogTerms,code:intro.code,revision:1,productKind:'intro',name:'First mat week revised',amountCents:4900,validDays:7,credits:4,eligibility:'new',limit:'person'});
  let state=await h.state();
  await h.cmd('intro.purchase',{id:waiting.id,key:waiting.key,confirm:true},waitingMember.cookie,409);
  await h.cmd('intro.preview',{offerId:intro2.introOfferId,requestId:'synthetic-strap-second-intro'},introMember.cookie,409);
  assert.equal((await h.state()).version,state.version,'changed catalog previews and cross-version duplicate intros leave money and credits unchanged');
  const retiredPreview=await h.cmd('intro.preview',{offerId:intro2.introOfferId,requestId:'synthetic-strap-intro-retired'},waitingMember.cookie);
  await h.cmd('catalog.retire',{id:intro2.productId,revision:2});state=await h.state();
  await h.cmd('intro.purchase',{id:retiredPreview.id,key:retiredPreview.key,confirm:true},waitingMember.cookie,409);
  await h.cmd('catalog.publish',{...catalogTerms,code:fixed.code,revision:1,productKind:'drop-in'},h.owner,409);
  assert.equal((await h.state()).version,state.version,'retirement refuses a waiting sale and stable product kinds cannot change');
  for(const {id,version,member} of sales) {
    const state=await h.state(member.cookie),pack=state.packs.find(p=>p.id===id);
    assert.deepEqual(pack.catalogVersion,version);
    assert.equal(state.charges.filter(c=>c.packId===id).length,1);
    assert.equal(state.charges.find(c=>c.packId===id).amountCents,version.amountCents);
    assert.equal(state.charges.find(c=>c.packId===id).catalogVersionId,version.id);
    const page=await h.send('/app/packs',undefined,member.cookie);
    assert.equal(page.status,200);assert.ok(page.text.includes(version.name));
  }
  console.log('PROBE PLAN-001 catalog breadth: published fixed-term, drop-in and intro products -> unlimited fixed term, one drop-in credit and verified three-credit intro sold at original USD terms.');
  console.log('PROBE PLAN-001 intro safety: unverified identity, changed or retired preview and duplicate new-version intro -> refused without charge or credit writes; accepted replay retains one sale.');
  return {sales,versions:[fixed,drop,intro,intro2],retiredPreview};
}

export async function assertCatalogBreadthRestored(h,data,cookie) {
  const state=await h.state(cookie);
  for(const version of data.versions)assert.deepEqual(state.productCatalog.versions.find(v=>v.id===version.id),version);
  for(const {id,version} of data.sales) {
    const pack=state.packs.find(p=>p.id===id);
    assert.deepEqual(pack.catalogVersion,version);assert.equal(pack.purchaseAmountCents,version.amountCents);
    assert.equal(state.charges.find(c=>c.packId===id).catalogVersionId,version.id);
  }
  const before=state.version;
  await h.cmd('intro.purchase',{id:data.retiredPreview.id,key:data.retiredPreview.key,confirm:true},cookie,404);
  assert.equal((await h.state(cookie)).version,before,'restored preview does not gain different-actor authority');
}

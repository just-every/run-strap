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
  assert.deepEqual(state.productCatalog.versions,[data.v1,data.v2,data.v3]);
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

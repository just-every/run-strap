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

export async function catalogCheckout(h) {
  const buyer=await h.person('CatalogBuyer'),deskBuyer=await h.person('CatalogDeskBuyer'),outsider=await h.person('CatalogOutsider'),desk=await h.person('CatalogDesk');
  const monthly=await h.cmd('catalog.publish',{...catalogTerms,code:'synthetic-strap-monthly',name:'Monthly mat',productKind:'monthly',revision:0,amountCents:14900});
  const finite=await h.cmd('catalog.publish',{...catalogTerms,code:'synthetic-strap-checkout',name:'Checkout mat pack',productKind:'finite-pack',revision:0,amountCents:12900,credits:6});
  const annual=await h.cmd('catalog.publish',{...catalogTerms,code:'synthetic-strap-annual',name:'Annual mat',productKind:'annual',revision:0,amountCents:149000});
  const grant=rights=>h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:Object.fromEntries(rights.map(right=>[right,{enabled:true,scopes:[{memberIds:[deskBuyer.id],locationIds:['studio'],doors:['all']}]}]))});
  await grant(['member-record']);await h.enroll(desk.cookie);
  let before=await h.state();
  await h.cmd('catalog.purchase.preview.staff',{personId:deskBuyer.id,catalogVersionId:monthly.id,requestId:'synthetic-strap-denied'},desk.cookie,403);
  await h.cmd('pack.prepare',{personId:buyer.id,catalogVersionId:monthly.id},h.owner,409);
  await h.cmd('catalog.purchase.preview',{personId:outsider.id,catalogVersionId:monthly.id,requestId:'synthetic-strap-other-member'},buyer.cookie,404);
  assert.equal((await h.state()).version,before.version,'monthly purchases cannot bypass scoped rights or personal acceptance');
  const self=await h.cmd('catalog.purchase.preview',{catalogVersionId:monthly.id,requestId:'synthetic-strap-member-purchase'},buyer.cookie);
  assert.match(self.consent,/149\.00 USD/);assert.match(self.consent,/every 1 calendar month/);assert.match(self.consent,/No card or bank payment/);
  before=await h.state();
  await h.cmd('catalog.purchase.confirm',{id:self.id,key:self.key,confirm:true},h.owner,403);
  await h.cmd('catalog.purchase.confirm',{id:self.id,key:self.key,confirm:true},outsider.cookie,404);
  await h.cmd('catalog.purchase.confirm',{id:self.id,key:self.key+'changed',confirm:true},buyer.cookie,409);
  assert.equal((await h.state()).version,before.version,'wrong actor or changed consent cannot create debt');
  const results=await Promise.all([1,2].map(()=>h.send('/api/strap/command',{name:'catalog.purchase.confirm',input:{id:self.id,key:self.key,confirm:true}},buyer.cookie)));
  assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>r.status===200||r.status===409));
  const selfSale=await h.cmd('catalog.purchase.confirm',{id:self.id,key:self.key,confirm:true},buyer.cookie);
  await grant(['member-record','membership-sale']);
  before=await h.state();
  await h.cmd('catalog.purchase.preview.staff',{personId:outsider.id,catalogVersionId:monthly.id,requestId:'synthetic-strap-out-of-scope'},desk.cookie,403);
  assert.equal((await h.state()).version,before.version);
  before=await h.state();
  await h.cmd('catalog.purchase.preview.staff',{personId:deskBuyer.id,catalogVersionId:monthly.id,requestId:'synthetic-strap-staff-membership'},desk.cookie,409);
  assert.equal((await h.state()).version,before.version,'staff cannot bypass payment-method authorization and signing for memberships');
  const finitePreview=await h.cmd('catalog.purchase.preview',{catalogVersionId:finite.id,requestId:'synthetic-strap-finite-self'},buyer.cookie);
  const finiteSale=await h.cmd('catalog.purchase.confirm',{id:finitePreview.id,key:finitePreview.key,confirm:true},buyer.cookie);
  const staffPreview=await h.cmd('catalog.purchase.preview.staff',{personId:deskBuyer.id,catalogVersionId:finite.id,requestId:'synthetic-strap-desk-preview',channel:'desk'},desk.cookie);
  before=await h.state();
  await h.cmd('catalog.purchase.confirm.staff',{id:staffPreview.id,key:staffPreview.key,confirm:true},desk.cookie,409);
  assert.equal((await h.state()).version,before.version,'staff cannot activate their own proposal without member acceptance');
  const accepted=await h.cmd('catalog.purchase.confirm',{id:staffPreview.id,key:staffPreview.key,confirm:true},deskBuyer.cookie);
  assert.equal(accepted.status,'accepted');
  assert.equal((await h.state()).packs.some(p=>p.catalogPurchaseId===staffPreview.id),false);
  await grant(['member-record']);before=await h.state();
  await h.cmd('catalog.purchase.confirm.staff',{id:staffPreview.id,key:staffPreview.key,confirm:true},desk.cookie,403);
  assert.equal((await h.state()).version,before.version,'revocation blocks an already accepted waiting sale');
  await grant(['member-record','membership-sale']);
  const staffSale=await h.cmd('catalog.purchase.confirm.staff',{id:staffPreview.id,key:staffPreview.key,confirm:true,requestId:'synthetic-strap-desk-confirm'},desk.cookie);
  await h.cmd('catalog.purchase.confirm.staff',{id:staffPreview.id,key:staffPreview.key,confirm:true,requestId:'synthetic-strap-desk-confirm'},desk.cookie);
  const annualPreview=await h.cmd('catalog.purchase.preview',{catalogVersionId:annual.id,requestId:'synthetic-strap-annual-purchase'},outsider.cookie);
  const annualSale=await h.cmd('catalog.purchase.confirm',{id:annualPreview.id,key:annualPreview.key,confirm:true},outsider.cookie);
  const stale=await h.cmd('catalog.purchase.preview',{catalogVersionId:monthly.id,requestId:'synthetic-strap-stale-checkout'},outsider.cookie);
  const changed=await h.cmd('catalog.publish',{...catalogTerms,code:monthly.code,name:'Monthly mat revised',productKind:'monthly',revision:1,amountCents:17900});
  before=await h.state();await h.cmd('catalog.purchase.confirm',{id:stale.id,key:stale.key,confirm:true},outsider.cookie,409);
  assert.equal((await h.state()).version,before.version);
  const retired=await h.cmd('catalog.purchase.preview',{catalogVersionId:changed.id,requestId:'synthetic-strap-retired-checkout'},outsider.cookie);
  await h.cmd('catalog.retire',{id:changed.productId,revision:2});before=await h.state();
  await h.cmd('catalog.purchase.confirm',{id:retired.id,key:retired.key,confirm:true},outsider.cookie,409);
  assert.equal((await h.state()).version,before.version);
  const finite2=await h.cmd('catalog.publish',{...catalogTerms,code:finite.code,name:'Checkout mat pack revised',productKind:'finite-pack',revision:1,amountCents:15900,credits:8});
  const sales=[{sale:selfSale,member:buyer,version:monthly},{sale:finiteSale,member:buyer,version:finite},{sale:staffSale,member:deskBuyer,version:finite},{sale:annualSale,member:outsider,version:annual}];
  const state=await h.state();
  for(const {sale,member,version} of sales) {
    const visible=await h.state(member.cookie),pack=visible.packs.find(p=>p.id===sale.packId),terms=visible.recurring.terms.find(t=>t.catalogPurchaseId===sale.id);
    assert.deepEqual(pack.catalogVersion,version);
    if(version.intervalMonths) {assert.equal(pack.entitlement.kind,'unlimited');assert.equal(pack.credits,0);} else assert.deepEqual([pack.credits,pack.remaining],[6,6]);
    assert.equal(visible.charges.filter(c=>c.packId===pack.id).length,1);assert.equal(visible.charges.find(c=>c.packId===pack.id).amountCents,version.amountCents);
    if(version.intervalMonths) {
    assert.equal(terms.amountCents,version.amountCents);assert.equal(terms.intervalMonths,version.intervalMonths);assert.equal(terms.firstDueAt,pack.expiresAt);
    assert.equal(terms.status,'active');assert.equal(terms.acceptedBy,sale.acceptedBy);assert.equal(terms.collection,'studio-balance-only');
    assert.equal(terms.acknowledgement.text,sale.consent);assert.deepEqual(terms.catalogVersion,version);
    } else assert.equal(terms,undefined);
    assert.equal(state.payments.some(p=>p.packId===pack.id),false,'catalog checkout never fabricates collected money');
  }
  const audit=state.staffActions.filter(a=>a.command==='catalog.purchase.confirm.staff'&&a.after.id===staffSale.id);
  assert.equal(audit.length,1);assert.equal(audit[0].personId,deskBuyer.id);assert.equal(audit[0].right,'membership-sale');assert.equal(audit[0].channel,'desk');
  await grant(['member-record']);before=await h.state();
  await h.cmd('catalog.purchase.confirm.staff',{id:staffPreview.id,key:staffPreview.key,confirm:true,requestId:'synthetic-strap-desk-confirm'},desk.cookie,403);
  assert.equal((await h.state()).version,before.version,'revoked rights also refuse committed replays');
  await grant(['member-record','membership-sale']);
  console.log('PROBE PLAN-001 monthly and annual checkout: personal exact acceptance -> one original charge and unlimited initial term plus accepted native recurring invoices; later price changes preserve sold monthly terms and both finite purchases.');
  console.log('PROBE PLAN-001 staff sales: scoped desk proposal, member acceptance and fresh staff confirmation -> one canonical membership-sale audit; denied, wrong-member and revoked preview or replay leave state unchanged.');
  const oneTime=[];
  for(const kind of ['drop-in','fixed-term']) {
    const version=(await h.state(buyer.cookie)).catalogStore.versions.find(v=>v.kind===kind);
    const preview=await h.cmd('catalog.purchase.preview',{catalogVersionId:version.id,requestId:'synthetic-strap-self-'+kind},buyer.cookie);
    const sale=await h.cmd('catalog.purchase.confirm',{id:preview.id,key:preview.key,confirm:true},buyer.cookie);
    const state=await h.state(buyer.cookie),pack=state.packs.find(p=>p.id===sale.packId);
    assert.deepEqual(pack.catalogVersion,version);assert.equal(state.charges.find(c=>c.packId===pack.id).amountCents,version.amountCents);
    assert.equal(state.recurring.terms.some(t=>t.catalogPurchaseId===sale.id),false,'one-time product never creates a recurring agreement');
    if(kind==='drop-in')assert.deepEqual([pack.credits,pack.remaining],[1,1]);else assert.equal(pack.entitlement.kind,'unlimited');
    oneTime.push({sale,version});
  }
  const erased=await h.person('CatalogErase');
  const erasedPreview=await h.cmd('catalog.purchase.preview',{catalogVersionId:annual.id,requestId:'synthetic-strap-erasure-preview'},erased.cookie);
  const {verifiedPrivacyRequest,privacyDecision}=await import('./privacy-journey.mjs');
  const request=await verifiedPrivacyRequest(h,erased,'erasure','-catalog');
  const review=await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision});
  await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true});
  before=await h.state();
  await h.cmd('catalog.purchase.confirm',{id:erasedPreview.id,key:erasedPreview.key,confirm:true},erased.cookie,401);
  assert.equal((await h.state()).version,before.version,'erased personal authority cannot replay a pending catalog purchase');
  assert.equal((await h.state(buyer.cookie)).catalogPurchases.some(p=>p.id===erasedPreview.id),false);
  console.log('PROBE PLAN-001 one-time and erasure: personal drop-in and fixed-term checkout -> original one-time entitlements with no recurring terms; erased preview replay -> 401 and unchanged ledger.');
  const waiting=await h.cmd('catalog.purchase.preview',{catalogVersionId:annual.id,requestId:'synthetic-strap-uncommitted-preview'},outsider.cookie);
  const staffWaiting=await h.cmd('catalog.purchase.preview.staff',{personId:deskBuyer.id,catalogVersionId:finite2.id,requestId:'synthetic-strap-uncommitted-staff'},desk.cookie);
  return {sales,oneTime,monthly,annual,finite,finite2,changed,desk,buyer,deskBuyer,outsider,retired,waiting,staffWaiting};
}

export async function assertCatalogCheckoutRestored(h,data,cookie) {
  const state=await h.state(cookie);
  for(const {sale,version} of data.sales) {
    const pack=state.packs.find(p=>p.id===sale.packId),terms=state.recurring.terms.find(t=>t.catalogPurchaseId===sale.id);
    assert.deepEqual(pack.catalogVersion,version);assert.equal(pack.purchaseAmountCents,version.amountCents);
    if(version.intervalMonths) {
      assert.deepEqual(terms.catalogVersion,version);assert.equal(terms.amountCents,version.amountCents);
      assert.equal(terms.requiresFreshAcceptance,true,'native restore cannot reactivate original recurring authority');
    }
    assert.equal(state.charges.filter(c=>c.packId===pack.id).length,1);
  }
  for(const {sale,version} of data.oneTime) {
    const pack=state.packs.find(p=>p.id===sale.packId);assert.deepEqual(pack.catalogVersion,version);
    assert.equal(state.charges.find(c=>c.packId===pack.id).amountCents,version.amountCents);
  }
  const person=await h.signIn(data.outsider.email),before=await h.state(cookie);
  await h.cmd('catalog.purchase.preview',{catalogVersionId:data.annual.id,requestId:'synthetic-strap-restored-invoices'},person,409);
  for(const preview of [data.retired,data.waiting])await h.cmd('catalog.purchase.confirm',{id:preview.id,key:preview.key,confirm:true},person,409);
  const member=await h.signIn(data.deskBuyer.email);
  await h.cmd('catalog.purchase.confirm',{id:data.staffWaiting.id,key:data.staffWaiting.key,confirm:true},member,409);
  assert.equal((await h.state(cookie)).version,before.version);
}


export async function reviewRestoredCatalogBilling(h,data,cookie) {
  const reviewed=await h.cmd('catalog.publish',{...catalogTerms,code:data.annual.code,productKind:'annual',name:'Reviewed annual mat',revision:1,amountCents:data.annual.amountCents},cookie);
  const member=await h.signIn(data.outsider.email);
  const preview=await h.cmd('catalog.purchase.preview',{catalogVersionId:reviewed.id,requestId:'synthetic-strap-owner-reviewed-restore'},member);
  const sale=await h.cmd('catalog.purchase.confirm',{id:preview.id,key:preview.key,confirm:true},member);
  assert.equal(sale.status,'sold');
  const state=await h.state(cookie),terms=state.recurring.terms.find(t=>t.catalogPurchaseId===sale.id);
  assert.equal(terms.status,'active');assert.equal(terms.requiresFreshAcceptance,false);
  for(const {sale:old,version} of data.sales.filter(s=>s.version.intervalMonths)) {
    const oldTerms=state.recurring.terms.find(t=>t.catalogPurchaseId===old.id);
    assert.equal(oldTerms.requiresFreshAcceptance,true,'owner publication and fresh personal purchase cannot revive historical invoice authority');
    assert.equal(oldTerms.amountCents,version.amountCents);
  }
  console.log('PROBE PLAN-001 restored invoice authority: fresh member purchase before owner publication -> 409; reviewed owner publication and fresh personal consent -> new invoice agreement only, historical authority remains disconnected.');
}
